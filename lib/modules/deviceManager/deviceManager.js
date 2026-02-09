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
            const sortedEntries = Object.entries(onlineValues)
                .filter(([k]) => k !== 'object')
                .sort(([, a], [, b]) =>
                    a.object.common.name.localeCompare(b.object.common.name, { sensitivity: 'base' }),
                );
            for (const [k, v] of sortedEntries) {
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
                const innerSortedEntries = Object.entries(v)
                    .filter(([k]) => k !== 'object')
                    .sort(([, a], [, b]) =>
                        a.object.common.name.localeCompare(b.object.common.name, { sensitivity: 'base' }),
                    );
                for (const [key, value] of innerSortedEntries) {
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

        // historic Values
        if (this.adapter.objectStore.devices[id].historicValues) {
            const historicValues = this.adapter.objectStore.devices[id].historicValues;

            const sortedEntries = Object.entries(historicValues)
                .filter(([k]) => k !== 'object')
                .sort(([, a], [, b]) =>
                    a.object.common.name.localeCompare(b.object.common.name, { sensitivity: 'base' }),
                );

            for (const [, v] of sortedEntries) {
                const prefix = v.object.common.name;

                // ===== group the states into L1, L2 ... =====
                const groups = {};

                for (const [key, value] of Object.entries(v)) {
                    if (key === 'object') {
                        continue;
                    }
                    const postfix = value.object.common.name;
                    const timeKey = key.substring(key.indexOf('_') + 1);

                    groups[postfix] ??= [];
                    groups[postfix].push({
                        timeKey,
                        oid: value.object._id,
                    });
                }

                // ===== output the groups separate =====
                for (const [postfix, states] of Object.entries(groups)) {
                    // Header (one time))
                    historicValuesItems[`Header_${prefix}_${postfix}`] = {
                        newLine: true,
                        type: 'header',
                        text: `${prefix} ${postfix}`,
                        size: 3,
                    };

                    // ===== sort in the groupt chronological =====
                    states.sort((a, b) => this.getChronoOffset(a.timeKey) - this.getChronoOffset(b.timeKey));

                    // Output the states
                    for (const state of states) {
                        historicValuesItems[`Value_${prefix}_${postfix}_${state.timeKey}`] = {
                            type: 'state',
                            label: state.timeKey,
                            oid: state.oid,
                            foreign: true,
                        };
                    }
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

    /**
     * @param key Key tha is to define
     */
    getChronoOffset(key) {
        // Hours
        if (key === 'Last_1_Hour') {
            return 1;
        }
        if (key === 'Last_X_Hours') {
            return 10;
        }
        if (key.startsWith('Last_') && key.endsWith('_Hours')) {
            const hours = parseInt(key.match(/\d+/)?.[0], 10);
            return hours ?? 9999;
        }

        // Days
        if (key.startsWith('Today')) {
            const timevalue = 24;
            return key.endsWith('-1Year') ? 3 * 365 * 24 + timevalue + 1 : timevalue;
        }
        if (key.startsWith('Yesterday')) {
            const timevalue = 48;
            return key.endsWith('-1Year') ? 3 * 365 * 24 + timevalue + 1 : timevalue;
        }

        // Weeks
        if (key.startsWith('ThisWeek')) {
            const timevalue = 7 * 24;
            return key.endsWith('-1Year') ? 3 * 365 * 24 + timevalue : timevalue;
        }
        if (key.startsWith('LastWeek')) {
            const timevalue = 14 * 24;
            return key.endsWith('-1Year') ? 3 * 365 * 24 + timevalue : timevalue;
        }

        // Month
        if (key.startsWith('ThisMonth')) {
            const timevalue = 31 * 24;
            return key.endsWith('-1Year') ? 3 * 365 * 24 + timevalue : timevalue;
        }
        if (key.startsWith('LastMonth')) {
            const timevalue = 2 * 31 * 24;
            return key.endsWith('-1Year') ? 3 * 365 * 24 + timevalue : timevalue;
        }

        // Quarter
        if (key.startsWith('ThisQuarter')) {
            const timevalue = 3 * 31 * 24;
            return key.endsWith('-1Year') ? 3 * 365 * 24 + timevalue : timevalue;
        }
        if (key.startsWith('LastQuarter')) {
            const timevalue = 2 * 3 * 31 * 24;
            return key.endsWith('-1Year') ? 3 * 365 * 24 + timevalue : timevalue;
        }

        // Year
        if (key.startsWith('ThisYear')) {
            const timevalue = 365 * 24;
            return key.endsWith('-1Year') ? 3 * 365 * 24 + timevalue : timevalue;
        }
        if (key.startsWith('LastYear')) {
            const timevalue = 2 * 365 * 24;
            return key.endsWith('-1Year') ? 3 * 365 * 24 + timevalue : timevalue;
        }

        // Flexible Time
        if (key.startsWith('FlexibleTime')) {
            const hours = parseInt(key.match(/\d+/)?.[0], 10) + 50000;
            return hours ?? 9999;
        }
        // Unbekannt → nach unten
        return 100000;
    }
}

module.exports = GridVisDeviceManagement;
