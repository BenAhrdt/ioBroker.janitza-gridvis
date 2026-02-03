/**
 * class to handle assignments in case of the state name and folder
 */
class assignhandlerClass {
    /**
     * @param adapter data of the adapter (eg. for logging)
     */
    constructor(adapter) {
        this.adapter = adapter;
    }

    /**
     * @param value Value wich has to be assign
     */
    getRole(value) {
        if (value === 'PowerActive') {
            return 'value.power.active';
        } else if (value === 'PowerReactive') {
            return 'value.power.reactive ';
        } else if (value === 'PowerApparent') {
            return 'value.power ';
        } else if (value === 'U_Effective') {
            return 'value.voltage';
        } else if (value === 'ActiveEnergy') {
            return 'value.energy.active';
        } else if (value === 'ReactiveEnergy') {
            return 'value.energy.reactive';
        } else if (value === 'ActiveEnergyConsumed') {
            return 'value.energy.consumed';
        } else if (value === 'ActiveEnergySupplied') {
            return 'value.energy.produced';
        }
        return 'value';
    }
}

module.exports = assignhandlerClass;
