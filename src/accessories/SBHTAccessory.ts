/* eslint-disable max-len */
import { PlatformAccessory } from 'homebridge';

import { ShellyBluPlatform } from '../platform';
import BaseAccessory from './BaseAccessory';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SBHTAccessory extends BaseAccessory{

  constructor(
    private readonly platform: ShellyBluPlatform,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    device: any,
    platformAccessory?: PlatformAccessory,
  ) {

    super();

    if (!platformAccessory) {

      const uuid = this.platform.api.hap.uuid.generate(device.uniqueId);
      this._platformAccessory = new this.platform.api.platformAccessory(device.code, uuid);
      this._platformAccessory.context.unique_id = device.uniqueId;
      this._platformAccessory.context.code = device.code;

      // set accessory information
      this._platformAccessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Shelly')
        .setCharacteristic(this.platform.Characteristic.Model, 'Shelly BLU HT')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, device.uniqueId);

      if(device.payload) {
        this.updateStatus(device);
      }
    } else {
      this._platformAccessory = platformAccessory;
    }

  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateStatus(device: any) {
    this.platform.log.debug(`Update device ${device.uniqueId} status`);
    const characteristic = this.platform.api.hap.Characteristic;

    const _device = {
      uniqueId: device.uniqueId,
      code: device.code,
      // eslint-disable-next-line max-len
      statusLowBattery: device.payload['devicepower:0'].battery.percent < 10 ? characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL,
      temp: device.payload['temperature:0'].tC
    };
    this.platform.log.debug('%j', _device);

    const primaryService = this._platformAccessory.getService(this.platform.Service.TemperatureSensor) ||
          this._platformAccessory.addService(this.platform.Service.TemperatureSensor);
    primaryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery).setValue(_device.statusLowBattery);

    const temperatureSensor = this._platformAccessory.getService(this.platform.Service.TemperatureSensor) ||
      this._platformAccessory.addService(this.platform.Service.TemperatureSensor, `${_device.code} Temperature Sensor`, `${_device.uniqueId}-temperature-sensor`);
    temperatureSensor.getCharacteristic(this.platform.Characteristic.CurrentTemperature).setValue(_device.temp);
  }

}
