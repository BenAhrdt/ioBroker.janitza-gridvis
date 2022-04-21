"use strict";

/*
 * Created with @iobroker/create-adapter v2.1.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios");
const schedule = require("node-schedule");

// Load your modules here, e.g.:
// const fs = require("fs");

class JanitzaGridvis extends utils.Adapter {

	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "janitza-gridvis",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		// this.on("objectChange", this.onObjectChange.bind(this));
		this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));

		this.AdapterObjectsAtStart = {};

		this.configConnection = {};
		this.devices = {};
		this.cronJobs = {};

		this.internalIds = {
			onlineDevices: "onlineDevices",
			onlineValues: "onlineValues",
			historicDevices: "historicDevices",
			historicValues: "historicValues",
			devices: "devices",
			readValuesTrigger: "readValuesTrigger"
		};

		this.communicationStrings = {
			ready: "Ready",
			noCommunication : "Das konfigurierte Projekt antwortet nicht. Bitte prüfen Sie die Grundeinstellungen.",
			communicationOk : "Datenaustausch mit REST API erfolgreich.",
			noCommunicationSelect: "Keine Verbindung",
			noCommunicationSelectString: "Keine aktive Verbindung zu GridVis"
		};

		this.definedObjects = {
			noCommunication : {label:this.communicationStrings.noCommunicationSelectString,value:this.communicationStrings.noCommunicationSelect}
		};

		this.timeStrings = {
			today: "Today",
			yesterday: "Yesterday",
			thisWeek: "ThisWeek",
			lastWeek: "LastWeek",
			thisMonth: "ThisMonth",
			lastMonth: "LastMonth",
			thisQuater: "ThisQuarter",
			lastQuater: "LastQuarter",
			thisYear: "ThisYear",
			lastYear: "LastYear"
		};

		this.axiosConfig = {
			timeout:1000
		};
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// Initialize your adapter here

		// Reset the connection indicator during startup
		this.setState("info.connection", false, true);

		// Get all objects in the adapter (later)
		//this.AdapterObjectsAtStart = await this.getAdapterObjectsAsync();
		//this.log.info(JSON.stringify(this.AdapterObjectsAtStart));

		// Check the configed connection settings
		// in case there is no connection to GridVis possible
		// the adapter will not work
		const projectInfo = await this.checkConnectionToRestApi(this.config.adress,this.config.port,this.config.projectname);
		if(projectInfo){
			this.log.info(`GridVis-Version: ${projectInfo.version} - number of Devices: ${projectInfo.numberOfDevices}`);
		}
		else{
			this.log.warn("No active communication to GridVis");
			return;
		}
		await this.createInternalStates();
		this.createScheduleJobs();
		this.readOnlineValues();
		this.readHistoricValues();

		// Set connection established
		this.setState("info.connection", true, true);
	}

	async createInternalStates(){
		// Parse ans asign online values
		for(const index in this.config.onlineDeviceTable){
			if(this.config.onlineDeviceTable[index][this.internalIds.onlineDevices] != this.communicationStrings.noCommunicationSelect){
				const configedOnlineDevices = JSON.parse(this.config.onlineDeviceTable[index][this.internalIds.onlineDevices]);
				const configedOnlineValues = JSON.parse(this.config.onlineDeviceTable[index][this.internalIds.onlineValues]);
				const deviceId = configedOnlineDevices.id;
				if(!this.devices[deviceId]){
					this.devices[deviceId] = {};
					this.devices[deviceId].deviceName = configedOnlineDevices.deviceName;
					this.devices[deviceId].onlineValues = {};
				}
				if(!this.devices[deviceId].onlineValues[configedOnlineValues.value]){
					this.devices[deviceId].onlineValues[configedOnlineValues.value] = {};
					this.devices[deviceId].onlineValues[configedOnlineValues.value].valueName = configedOnlineValues.valueName;
					this.devices[deviceId].onlineValues[configedOnlineValues.value].type = {};
				}
				this.devices[deviceId].onlineValues[configedOnlineValues.value].type[configedOnlineValues.type] = {
					typeName: configedOnlineValues.typeName,
					unit: configedOnlineValues.unit
				};
			}
		}

		// Create onlinevalue structur
		for(const device in this.devices){
			if(this.devices[device].onlineValues){
				for(const value in this.devices[device].onlineValues){
					for(const type in this.devices[device].onlineValues[value].type){

						// Create device folder
						await this.setObjectAsync(`${this.internalIds.devices}.${device}`,{
							type:"device",
							common:{
								name: this.devices[device].deviceName
							},
							native : {},
						});

						// create onlinevalue folder
						await this.setObjectAsync(`${this.internalIds.devices}.${device}.${this.internalIds.onlineValues}`,{
							type:"folder",
							common:{
								name: "Ausgelesene Onlinewerte"
							},
							native : {},
						});

						// create value channel
						await this.setObjectAsync(`${this.internalIds.devices}.${device}.${this.internalIds.onlineValues}.${value}`,{
							type:"channel",
							common:{
								name: this.devices[device].onlineValues[value].valueName
							},
							native : {},
						});

						// create value state
						await this.setObjectAsync(`${this.internalIds.devices}.${device}.${this.internalIds.onlineValues}.${value}.${type}`,{
							type: "state",
							common: {
								name: this.devices[device].onlineValues[value].type[type].typeName,
								type: "number",
								role: "value",
								read: true,
								write: false,
								unit: this.devices[device].onlineValues[value].type[type].unit,
								def:0
							},
							native: {},
						});

					}
				}
			}
		}


		// Parse ans asign historic values
		for(const index in this.config.historicDeviceTable){
			if(this.config.historicDeviceTable[index][this.internalIds.historicDevices] != this.communicationStrings.noCommunicationSelect){
				const configedHistoricDevices = JSON.parse(this.config.historicDeviceTable[index][this.internalIds.historicDevices]);
				const configedHistoricValues = JSON.parse(this.config.historicDeviceTable[index][this.internalIds.historicValues]);
				const deviceId = configedHistoricDevices.id;
				if(!this.devices[deviceId]){
					this.devices[deviceId] = {};
					this.devices[deviceId].deviceName = configedHistoricDevices.deviceName;
				}
				// Create historic Values structure (in case if its not created or device is created in onlineValues)
				if(!this.devices[deviceId].historicValues){
					this.devices[deviceId].historicValues = {};
				}
				if(!this.devices[deviceId].historicValues[configedHistoricValues.value]){
					this.devices[deviceId].historicValues[configedHistoricValues.value] = {};
					this.devices[deviceId].historicValues[configedHistoricValues.value].valueName = configedHistoricValues.valueName;
					this.devices[deviceId].historicValues[configedHistoricValues.value].type = {};
				}
				this.devices[deviceId].historicValues[configedHistoricValues.value].type[configedHistoricValues.type] = {
					typeName: configedHistoricValues.typeName,
					unit: configedHistoricValues.unit,
					id: configedHistoricValues.id
				};
			}
		}

		// Create historic value structure
		for(const device in this.devices){
			if(this.devices[device].historicValues){
				for(const value in this.devices[device].historicValues){
					for(const type in this.devices[device].historicValues[value].type){

						// Create device folder
						await this.setObjectAsync(`${this.internalIds.devices}.${device}`,{
							type:"device",
							common:{
								name: this.devices[device].deviceName
							},
							native : {},
						});

						// create historic value folder
						await this.setObjectAsync(`${this.internalIds.devices}.${device}.${this.internalIds.historicValues}`,{
							type:"folder",
							common:{
								name: "Ausgelesene historische Werte"
							},
							native : {},
						});

						// create historic value channel
						await this.setObjectAsync(`${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}`,{
							type:"channel",
							common:{
								name: this.devices[device].historicValues[value].valueName
							},
							native : {},
						});

						// create value state
						for(const timeBase in this.timeStrings){
							await this.setObjectAsync(`${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings[timeBase]}`,{
								type: "state",
								common: {
									name: this.devices[device].historicValues[value].type[type].typeName,
									type: "number",
									role: "value",
									read: true,
									write: false,
									unit: this.devices[device].historicValues[value].type[type].unit,
									def:0
								},
								native: {},
							});
						}
					}
				}
			}
		}

		// Create read trigger for all devices
		await this.setObjectAsync(`${this.internalIds.devices}.${this.internalIds.readValuesTrigger}`,{
			type: "state",
			common: {
				name: "Werte lesen (einmalig)",
				type: "boolean",
				role: "state",
				read: true,
				write: true,
				def:false
			},
			native: {},
		});
		// Subscribe trigger state
		this.subscribeStatesAsync(`${this.internalIds.devices}.${this.internalIds.readValuesTrigger}`);

	}

	// create schedule Jobs for online and historic values
	createScheduleJobs(){
		this.cronJobs[this.config.refreshOnlineCronJob] = schedule.scheduleJob(this.config.refreshOnlineCronJob,this.readOnlineValues.bind(this));
		this.cronJobs[this.config.refreshHistoricCronJob] = schedule.scheduleJob(this.config.refreshHistoricCronJob,this.readHistoricValues.bind(this));
	}

	// read out all configed online values
	readOnlineValues(){
		// create url to read out onlinevalues
		let myUrl = "";
		for(const device in this.devices){
			if(this.devices[device].onlineValues){
				if(myUrl == ""){
					myUrl = `http://${this.config.adress}:${this.config.port}/rest/1/projects/${this.config.projectname}/onlinevalues/.json?value=${device};`;
				}
				else{
					myUrl += `&value=${device};`;
				}
				for(const value in this.devices[device].onlineValues){
					myUrl += `${value};`;
					for(const type in this.devices[device].onlineValues[value].type){
						myUrl += `${type},`;
					}
				}
			}
		}

		//check for Url
		if(myUrl != ""){
			// send request to gridvis and write a valid data into the internal state
			this.log.debug(`${myUrl} was send to gridVis`);
			axios.default.get(myUrl,this.axiosConfig)
				.then((result)=>{
					if(result.status == 200){
						for(const device in this.devices){
							if(this.devices[device].onlineValues){
								for(const value in this.devices[device].onlineValues){
									for(const type in this.devices[device].onlineValues[value].type){
										if(result.data.value[`${device}.${value}.${type}`] && result.data.value[`${device}.${value}.${type}`] != "NaN"){
											this.setStateAsync(`${this.internalIds.devices}.${device}.${this.internalIds.onlineValues}.${value}.${type}`,result.data.value[`${device}.${value}.${type}`],true);
										}
									}
								}
							}
						}
					}
				})
				.catch((error) =>{
					this.log.warn(error);
				});
		}
	}

	// red out all configed historic values
	readHistoricValues(){
	// create url to read out onlinevalues
		let myUrl = "";
		for(const device in this.devices){
			if(this.devices[device].historicValues){
				for(const value in this.devices[device].historicValues){
					for(const type in this.devices[device].historicValues[value].type){
						for(const timeBase in this.timeStrings){
							myUrl = `http://${this.config.adress}:${this.config.port}/rest/1/projects/${this.config.projectname}/devices/${device}/hist/energy/`;
							myUrl += `${value}/`;
							myUrl += `${type}/.json?start=NAMED_${this.timeStrings[timeBase]}&end=NAMED_${this.timeStrings[timeBase]}`;
							this.log.debug(`${myUrl} was send to gridVis`);
							axios.default.get(myUrl,this.axiosConfig)
								.then((result) =>{					// if there is a valid result of energy
									if(result.status == 200){		// write data into internal state
										if(result.data.energy && result.data.energy != "NaN"){
											this.setStateAsync(`${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings[timeBase]}`,result.data.energy,true);
										}
									}
								})
								.catch((error) =>{
									this.log.warn(error);
								});
						}
					}
				}
			}
		}
	}

	// Check the connection to GridVis
	async checkConnectionToRestApi(adress,port,projectname){
		try{
			const result = await axios.default.get(`http://${adress}:${port}/rest/1/projects/${projectname}.json?`,this.axiosConfig);
			if(result){
				if(result.data.status && result.data.status == this.communicationStrings.ready){
					const version = await axios.default.get(`http://${adress}:${port}/rest/common/info/version/full.json?`,this.axiosConfig);
					if(version){
						return {numberOfDevices:result.data.numberOfDevices,version:version.data.value};
					}
					else{
						return false;
					}
				}
				else{
					return false;
				}
			}
			else{
				return false;
			}
		}
		catch (e){
			return false;
		}
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 * @param {() => void} callback
	 */
	onUnload(callback) {
		try {
			// clear all schedules
			for(const cronJob in this.cronJobs)
			{
				schedule.cancelJob(this.cronJobs[cronJob]);
			}
			callback();
		} catch (e) {
			callback();
		}
	}

	// If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
	// You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
	// /**
	//  * Is called if a subscribed object changes
	//  * @param {string} id
	//  * @param {ioBroker.Object | null | undefined} obj
	//  */
	// onObjectChange(id, obj) {
	// 	if (obj) {
	// 		// The object was changed
	// 		this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
	// 	} else {
	// 		// The object was deleted
	// 		this.log.info(`object ${id} deleted`);
	// 	}
	// }

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	async onStateChange(id, state) {
		if (state) {
			if(id == `${this.namespace}.${this.internalIds.devices}.${this.internalIds.readValuesTrigger}`){
				if(!state.ack){
					if(state.val){
						this.readOnlineValues();
						this.readHistoricValues();
					}
					this.setStateAsync(id,state.val,true);
				}
			}
		}
	}

	// If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
	// /**
	//  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
	//  * Using this method requires "common.messagebox" property to be set to true in io-package.json
	//  * @param {ioBroker.Message} obj
	//  */
	async onMessage(obj) {

		let result;
		const devices = [];
		let myCount = 0;

		switch(obj.command){

			// check the connection state in case of adresse, port and projectname
			// send the resut back to the textfield in config
			case "getConnectionState":
			case "getConnectionStateOnlineTab":
			case "getConnectionStateHistoricTab":
				try{
					const projectInfo = await this.checkConnectionToRestApi(obj.message.adress,obj.message.port,obj.message.projectname);
					if(projectInfo){
						this.configConnection.adress = obj.message.adress;
						this.configConnection.port = obj.message.port;
						this.configConnection.projectname = obj.message.projectname;
						this.sendTo(obj.from, obj.command, `${this.communicationStrings.communicationOk} ${projectInfo.version} - Anzahl Geräte: ${projectInfo.numberOfDevices}`, obj.callback);
					}
					else{
						this.configConnection = {};
						this.sendTo(obj.from, obj.command, this.communicationStrings.noCommunication, obj.callback);
					}
				}
				catch(e){
					this.configConnection = {};
					this.sendTo(obj.from, obj.command, this.communicationStrings.noCommunication, obj.callback);
				}
				break;

			// in case the connection is ok get devices for online and historic configuration (same devices)
			// send the result array back to the select in config
			case "getOnlineDevices":
			case "getHistoricDevices":
				if(this.configConnection.port){
					try{
						result = await axios.default.get(`http://${this.configConnection.adress}:${this.configConnection.port}/rest/1/projects/${this.configConnection.projectname}/devices.json?`,this.axiosConfig);
						if(result){
							for(const element in result.data.device){
								const label = result.data.device[element].name + "  - Geräte-ID: " + result.data.device[element].id;
								const value = `{"id":${result.data.device[element].id},"deviceName":"${result.data.device[element].name}"}`;
								devices[myCount] = {label: label,value: value};
								myCount ++;
							}
							this.sendTo(obj.from, obj.command, devices, obj.callback);
						}
					}
					catch(e){
						this.sendTo(obj.from, obj.command,[this.definedObjects.noCommunication], obj.callback);
					}
				}
				else{
					this.sendTo(obj.from, obj.command,[this.definedObjects.noCommunication], obj.callback);
				}
				break;

			// in case the connection is ok get values for online configuration
			// send the result array back to the select in config
			case "getOnlineValues":
				if(obj.message && obj.message.id && this.configConnection.port)
				{
					try{
						result = await axios.default.get(`http://${this.configConnection.adress}:${this.configConnection.port}/rest/1/projects/${this.configConnection.projectname}/devices/${obj.message.id}/online/values.json?`,this.axiosConfig);
						if(result){
							const myValues = [];
							myCount = 0;
							for(const values in result.data.valuetype){
								let label = result.data.valuetype[values].valueName;
								if(result.data.valuetype[values].valueName != result.data.valuetype[values].typeName){
									label += " " + result.data.valuetype[values].typeName;
								}
								let value = "{";
								for(const myKey in result.data.valuetype[values]){
									if(value != "{")
									{
										value += ",";
									}
									value += `"${myKey}":"${result.data.valuetype[values][myKey]}"`;
								}
								value += "}";
								myValues[myCount] = {label: label, value: value};
								myCount ++;
							}
							this.sendTo(obj.from, obj.command, myValues, obj.callback);
						}
					}
					catch(e){
						this.sendTo(obj.from, obj.command,[this.definedObjects.noCommunication], obj.callback);
					}
				}
				else
				{
					this.sendTo(obj.from, obj.command, [this.definedObjects.noCommunication], obj.callback);
				}
				break;

			// in case the connection is ok get values for historic configuration
			// send the result array back to the select in config
			case "getHistoricValues":
				if(obj.message && obj.message.id && this.configConnection.port)
				{
					try{
						result = await axios.default.get(`http://${this.configConnection.adress}:${this.configConnection.port}/rest/1/projects/${this.configConnection.projectname}/devices/${obj.message.id}/hist/values.json?`,this.axiosConfig);
						if(result){
							const myValues = [];
							myCount = 0;
							for(const values in result.data.value){
								// Check for unit Wh
								if(result.data.value[values].valueType.unit == "Wh"){
									let label = result.data.value[values].valueType.valueName;
									if(result.data.value[values].valueType.valueName != result.data.value[values].valueType.typeName){
										label += " " + result.data.value[values].valueType.typeName;
									}
									let value = "{";
									for(const myKey in result.data.value[values].valueType){
										if(value != "{")
										{
											value += ",";
										}
										value += `"${myKey}":"${result.data.value[values].valueType[myKey]}"`;
									}
									value += `,"id":"${result.data.value[values].id}"`;
									value += "}";
									myValues[myCount] = {label: label, value: value};
									myCount ++;
								}
							}
							this.sendTo(obj.from, obj.command, myValues, obj.callback);
						}
					}
					catch(e){
						this.sendTo(obj.from, obj.command,[this.definedObjects.noCommunication], obj.callback);
					}
				}
				else
				{
					this.sendTo(obj.from, obj.command, [this.definedObjects.noCommunication], obj.callback);
				}
				break;
		}
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	module.exports = (options) => new JanitzaGridvis(options);
} else {
	// otherwise start the instance directly
	new JanitzaGridvis();
}