'use strict';
const { DeviceManagement } = require('@iobroker/dm-utils');

/**
 * DeviceManager Class
 */
class GridVisDeviceManagement extends DeviceManagement {
    /**
     * Initialize Class with Adapter
     *
     * @param adapter Adapter Reference
     */
    constructor(adapter) {
        super(adapter);
        this.adapter = adapter;
    }

    /**
     * List all devices
     */
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    async listDevices() {
        const arrDevices = [];
        for (const [deviceId, deviceValue] of Object.entries(this.adapter.objectStore.devices)) {
            const res = {
                id: deviceId,
                name: deviceValue.object.common.name,
                icon: await this.getIcon(deviceValue),
                manufacturer: 'Janitza',
                model: deviceValue.info?.type
                    ? deviceValue.info.type.state.val.replace('MeasurementGroup', '\nMeasurementGroup')
                    : undefined,
                status: await this.getStatus(),
                hasDetails: false,
            };
            arrDevices.push(res);
        }
        return arrDevices;
    }

    /**
     * getStatus
     */
    async getStatus() {
        const connection = await this.adapter.getStateAsync('info.connection');
        const status = {};
        status.connection = connection.val ? 'connected' : 'disconnected';
        return status;
    }

    /**
     *
     * @param deviceValue values of device
     */
    async getIcon(deviceValue) {
        const possibleIcons = {
            airCondition: 'airCondition',
            blind: 'blind',
            blindButtons: 'blindButtons',
            button: 'button',
            buttonSensor: 'buttonSensor',
            camera: 'camera',
            chart: 'chart',
            image: 'image',
            dimmer: 'dimmer',
            door: 'door',
            fireAlarm: 'fireAlarm',
            floodAlarm: 'floodAlarm',
            gate: 'gate',
            humidity: 'humidity',
            illuminance: 'illuminance',
            info: 'info',
            light: 'light',
            lock: 'lock',
            location: 'location',
            locationOne: 'locationOne',
            media: 'media',
            motion: 'motion',
            ct: 'ct',
            percentage: 'percentage',
            rgb: 'rgb',
            rgbSingle: 'rgbSingle',
            rgbwSingle: 'rgbwSingle',
            hue: 'hue',
            cie: 'cie',
            slider: 'slider',
            socket: 'socket',
            temperature: 'temperature',
            thermostat: 'thermostat',
            vacuumCleaner: 'vacuumCleaner',
            volume: 'volume',
            volumeGroup: 'volumeGroup',
            window: 'window',
            windowTilt: 'windowTilt',
            weatherCurrent: 'weatherCurrent',
            weatherForecast: 'weatherForecast',
            warning: 'warning',

            unknown: 'unknown',
            instance: 'instance',

            // Special matter types
            invalid: 'invalid',
            hub3: 'hub3',
            node: 'node',
            hub5: 'hub5',
            controller: 'controller',
        };
        if (deviceValue.entityType) {
            if (deviceValue.entityType['clima']) {
                return possibleIcons.thermostat;
            } else if (deviceValue.entityType['light']) {
                return possibleIcons.light;
            } else if (deviceValue.entityType['humidifier']) {
                return possibleIcons.humidity;
            } else if (deviceValue.entityType['lock']) {
                return possibleIcons.lock;
            }
        }
        if (deviceValue.detectedRoles) {
            if (deviceValue.detectedRoles['level.temperature']) {
                return possibleIcons.thermostat;
            } else if (deviceValue.detectedRoles['sensor.door']) {
                return possibleIcons.door;
            } else if (deviceValue.detectedRoles['sensor.window']) {
                return possibleIcons.window;
            } else if (deviceValue.detectedRoles['sensor.contact']) {
                return `/adapter/${this.adapter.name}/icons/sensor.contact.png`;
            } else if (deviceValue.detectedRoles['sensor.motion']) {
                return possibleIcons.motion;
            } else if (deviceValue.detectedRoles['value.temperature']) {
                if (deviceValue.detectedRoles['value.pressure']) {
                    return possibleIcons.weatherCurrent;
                }
                if (deviceValue.detectedRoles['value.humidity']) {
                    return possibleIcons.humidity;
                }
                return possibleIcons.temperature;

                // Energy
            } else if (deviceValue.detectedRoles['value.energy.produced']) {
                return `/adapter/${this.adapter.name}/icons/produced.png`;
            } else if (deviceValue.detectedRoles['value.energy.consumed']) {
                return `/adapter/${this.adapter.name}/icons/consumed.png`;
            } else if (deviceValue.detectedRoles['value.energy.active']) {
                return `/adapter/${this.adapter.name}/icons/energy.png`;
            } else if (deviceValue.detectedRoles['value.energy.reactive']) {
                return `/adapter/${this.adapter.name}/icons/energy.png`;
            } else if (deviceValue.detectedRoles['value.energy']) {
                return `/adapter/${this.adapter.name}/icons/power.png`;

                // Power
            } else if (deviceValue.detectedRoles['value.power.produced']) {
                return `/adapter/${this.adapter.name}/icons/produced.png`;
            } else if (deviceValue.detectedRoles['value.power.consumed']) {
                return `/adapter/${this.adapter.name}/icons/consumed.png`;
            } else if (deviceValue.detectedRoles['value.power.active']) {
                return `/adapter/${this.adapter.name}/icons/power.png`;
            } else if (deviceValue.detectedRoles['value.power.reactive']) {
                return `/adapter/${this.adapter.name}/icons/power.png`;
            } else if (deviceValue.detectedRoles['value.power']) {
                return `/adapter/${this.adapter.name}/icons/power.png`;
            }

            // Check informations
            if (deviceValue.informations['angle']) {
                return `/adapter/${this.adapter.name}/icons/angle.png`;
            } else if (deviceValue.informations['absoluteHumidity']) {
                return possibleIcons.humidity;
            }
        }
        return `/adapter/${this.adapter.name}/icons/consumed.png`; //${value.object.common.icon}`,
    }
}

module.exports = GridVisDeviceManagement;
