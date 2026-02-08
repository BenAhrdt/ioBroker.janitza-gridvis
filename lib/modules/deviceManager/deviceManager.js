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
        let primary = true;
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
                hasDetails: true,
                backgroundColor: primary ? 'primary' : 'secondary',
            };
            arrDevices.push(res);
            primary = !primary;
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
        if (deviceValue.object?.common?.icon) {
            return `/adapter/${this.adapter.name}/${deviceValue.object.common.icon}`;
        }
        return `/adapter/${this.adapter.name}/icons/default.png`;
    }

    /**
     * @param {string} id ID from device
     * @returns {Promise<import('@iobroker/dm-utils').DeviceDetails>} return the right value
     */
    async getDeviceDetails(id) {
        // eslint-disable-next-line jsdoc/check-tag-names
        /** @type {Record<string, import('@iobroker/dm-utils').ConfigItemAny>} */
        const onlineValuesItems = {};
        // eslint-disable-next-line jsdoc/check-tag-names
        /** @type {Record<string, import('@iobroker/dm-utils').ConfigItemAny>} */
        const historicValuesItems = {};
        const data = {};

        // Online Values
        if (this.adapter.objectStore.devices[id].onlineValues) {
            const onlineValues = this.adapter.objectStore.devices[id].onlineValues;
            for (const [k, v] of Object.entries(this.adapter.objectStore.devices[id].onlineValues)) {
                if (k === 'object') {
                    continue;
                }
                const prefix = onlineValues[k].object.common.name;
                onlineValuesItems[`${prefix}_Header`] = {
                    newLine: true,
                    type: 'header',
                    text: prefix,
                    size: 3,
                };
                for (const [key, value] of Object.entries(v)) {
                    if (key === 'object') {
                        continue;
                    }
                    const postfix = value.object.common.name;
                    onlineValuesItems[`Value_${prefix}_${postfix}`] = {
                        type: 'state',
                        label: `${postfix}`,
                        oid: value.object._id,
                        foreign: true,
                    };
                }
            }
        }

        // historix Values
        if (this.adapter.objectStore.devices[id].historicValues) {
            const historicValues = this.adapter.objectStore.devices[id].historicValues;
            for (const [k, v] of Object.entries(this.adapter.objectStore.devices[id].historicValues)) {
                if (k === 'object') {
                    continue;
                }
                const prefix = historicValues[k].object.common.name;
                for (const [key, value] of Object.entries(v)) {
                    if (key === 'object') {
                        continue;
                    }
                    const postfix = value.object.common.name;
                    historicValuesItems[`${prefix}_${postfix}_Header`] = {
                        newLine: true,
                        type: 'header',
                        text: `${prefix} ${postfix}`,
                        size: 3,
                    };
                    const clearKey = key.substring(key.indexOf('_') + 1, key.length);
                    historicValuesItems[`Value_${prefix}_${postfix}_${key}`] = {
                        type: 'state',
                        label: clearKey,
                        oid: value.object._id,
                        foreign: true,
                        noTranslation: true,
                    };
                }
            }
        }

        // eslint-disable-next-line jsdoc/check-tag-names
        /** @type {import('@iobroker/dm-utils').JsonFormSchema} */
        const schema = {
            type: 'tabs',
            tabsStyle: {
                minWidth: 850,
            },
            items: {},
        };
        if (this.adapter.objectStore.devices[id].onlineValues) {
            schema.items.onlineValues = {
                type: 'panel',
                label: 'onlineValues',
                items: onlineValuesItems,
            };
        }
        if (this.adapter.objectStore.devices[id].historicValues) {
            schema.items.historicValues = {
                type: 'panel',
                label: 'historicValues',
                items: historicValuesItems,
            };
        }
        // return the schema
        return { id, schema, data };
    }
}

module.exports = GridVisDeviceManagement;
