/* eslint-disable @typescript-eslint/no-explicit-any */
import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { SBDWAccessory } from './accessories/SBDWAccessory';
import { SBHTAccessory } from './accessories/SBHTAccessory';

import ShellyCloudApi from './oauth';
import { client as WebSocketClient } from 'websocket';
import {
  is_shelly_generic_response,
  is_shelly_statusonchange,
} from './shellyTypes';
import BaseAccessory from './accessories/BaseAccessory';

const AccessoriesFactoryMap = {
  'SBDW': SBDWAccessory,
  'SBHT': SBHTAccessory,
};

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class ShellyBluPlatform implements DynamicPlatformPlugin {
  readonly deviceDelegates: Map<string, BaseAccessory> = new Map();

  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: BaseAccessory[] = [];

  private _shellyApi: ShellyCloudApi | undefined;

  private _wsClient;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    if (this.config.email && this.config.password) {
      this._shellyApi = new ShellyCloudApi(log, config, api);
      this._wsClient = new WebSocketClient();

      this.api.on('didFinishLaunching', () => {
        log.debug('Executed didFinishLaunching callback');

        this.discoverDevices().then(async (devices: Array<any>) => {
          this.registerDevices(devices);
          await this.handleDevicesStateChanges(devices);
        });

      });
    } else {
      log.info('Plugin not configured. Skip');
    }

  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(platformAccessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', platformAccessory.displayName);

    const deviceType = platformAccessory.context.code.split('-')[0] 
    const classToCreate = AccessoriesFactoryMap[deviceType];

    if (classToCreate) {
      const accessory = new classToCreate(this, {
        uniqueId: platformAccessory.context.uniqueId,
        code: platformAccessory.context.code,
      }, platformAccessory);

      this.accessories.push(accessory);
    }
  }

  async discoverDevices(): Promise<Array<any>> {
    // for(const a of this.accessories) {
    //   this.log.info('%j', a.platformAccessory.UUID);
    //   this.log.info('Removing existing accessory from cache:', a.platformAccessory.displayName);
    //   this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [a.platformAccessory]);
    // }

    const devices: Array<any> = [];
    if (this._shellyApi) {
      try {
        const payload = await this._shellyApi.call('/device/all_status');
        if (is_shelly_generic_response(payload) && payload.isok === true) {
          for(const deviceId in (payload.data as any).devices_status) {
            if((payload.data as any).devices_status[deviceId]._dev_info?.gen === 'GBLE') {
              devices.push({
                uniqueId: (payload.data as any).devices_status[deviceId]._dev_info.id,
                code: (payload.data as any).devices_status[deviceId]._dev_info.code,
                payload: (payload.data as any).devices_status[deviceId],
              });
            }
          }
        }
      } catch { /* empty */ }
    }

    return devices;
  }

  async handleDevicesStateChanges(devices) {
    if (this._shellyApi && devices.length > 0) {
      const wsClientEndpoint = await this._shellyApi.getWSEndpoint();
      this.log.debug(wsClientEndpoint);
      this._wsClient.on('connectFailed', (error) => {
        this.log.error('Connect Error: ' + error.toString());
        this.handleDevicesStateChanges(devices);
      });

      this._wsClient.on('connect', (connection) => {
        this.log.info('Connection established!');

        connection.on('error', (error) => {
          this.log.error('Connection error: ' + error.toString());
          this.handleDevicesStateChanges(devices);
        });

        connection.on('close', () => {
          this.log.info('Connection closed!');
        });

        connection.on('message', (message) => {
          const payload = JSON.parse(message.utf8Data);
          this.log.debug('Got message! ' + payload);

          if(is_shelly_statusonchange(payload)) {
            this.log.debug('%j', payload);
            const uuid = this.api.hap.uuid.generate(payload.device.id as any);
            const existingAccessory = this.accessories.find(accessory => accessory.platformAccessory.UUID === uuid);
            if(existingAccessory && AccessoriesFactoryMap[payload.device.code.split('-')[0]]) {
              existingAccessory.updateStatus({
                uniqueId: payload.device.id,
                code: payload.device.code,
                payload: payload.status,
              });
            }
          }
        });
      });

      this._wsClient.connect(wsClientEndpoint);
    }
  }

  registerDevices(devices) {
    const newAccessories: Array<PlatformAccessory> = [];

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of devices) {

      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.uniqueId);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.platformAccessory.UUID === uuid);
      this.log.debug('%j', device);

      const deviceType = device.code.split('-')[0]
      const classToCreate = AccessoriesFactoryMap[deviceType];
  
      if (classToCreate) {
        const accessory = new classToCreate(this, device);

        if(!existingAccessory) {
          // the accessory does not yet exist, so we need to create it
          this.log.info('Adding new accessory:', device.code);
          newAccessories.push(accessory.platformAccessory)
          this.accessories.push(accessory);
        } else {
          this.log.info('Restore accessory from cache:', device.code);
          accessory.updateStatus(device);
        }

      } 
    }

    if(this.accessories.length > 0) {
      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, newAccessories);
    }
  }
}
