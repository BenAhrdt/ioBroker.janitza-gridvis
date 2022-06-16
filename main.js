"use strict";

/*
 * Created with @iobroker/create-adapter v2.1.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require("axios").default;
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

		// cron Jobs
		this.cronJobs = {};
		this.cronJobIds = {
			getAdditionalDeviceInformations : "getAdditionalDeviceInformations",
			refreshOnlineCronJob : "refreshOnlineCronJob",
			refreshHistoricCronJob : "refreshHistoricCronJob"
		};
		this.cronJobValues = {
			getAdditionalDeviceInformations: "* * * * *"
		};

		// Timeouts
		this.timeouts = {};
		this.timeoutIds = {
			connectionTimeout : "connectionTimeout"
		};
		this.timeoutValues = {
			connectionTimeout : 10000
		};

		this.internalIds = {
			onlineDevices: "onlineDevices",
			onlineValues: "onlineValues",
			historicDevices: "historicDevices",
			historicValues: "historicValues",
			devices: "devices",
			readValuesTrigger: "readValuesTrigger",
			globalValue: "GlobalValue",
			userDefined: "UserDefined",
			reconnectCount: "reconnectCount",
			info: "info",
			serialNumber: "serialNumber",
			firmware: "firmware",
			hardware: "hardware"
		};

		this.communicationStrings = {
			connectedToGridVisVersion: "Connected to GridVis-Version",
			numberOfDevices: "number of devices",
			ready: "Ready",
			noCommunication : "The configured project does not respond. Please check the basic settings.",
			communicationOk : "Data exchange with REST API successful.",
			noCommunicationSelect: "No connection",
			noCommunicationSelectString: "No active connection to GridVis",
			lastCommunicationError: "last communication error"
		};

		this.translationIds = {
			onlineValues: "online values",
			historicValues: "historic values"
		};

		// later defined (after translation is loaded)
		this.definedObjects = {};

		this.timeStrings = {
			today: "Today",
			yesterday: "Yesterday",
			thisWeek: "ThisWeek",
			lastWeek: "LastWeek",
			thisMonth: "ThisMonth",
			lastMonth: "LastMonth",
			thisQuarter: "ThisQuarter",
			lastQuarter: "LastQuarter",
			thisYear: "ThisYear",
			lastYear: "LastYear"
		};

		// internal connection state to block timeout errors
		this.internalConnectionState = false;

		// reconnect counter for counting reconnects before lor warning
		this.reconnectErrorString = "";
		this.reconnectCounter = 0;

		// Transalation for some channel names
		this.i18nTranslation = {};

		// object of icons in folde admin/icons
		this.presentIcons = {};
		this.defaultIcon = "default.png";

		this.devicesWithSerialNumber = undefined;
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		// read system translation out of i18n translation
		this.i18nTranslation = await this.geti18nTranslation();

		// read out present icons
		const dirInfo = await this.readDirAsync(this.name + ".admin","/icons/");
		dirInfo.forEach(info => {
			this.presentIcons[info.file.substring(0,info.file.indexOf("."))] = info.file;
		});

		// definition der internen Objecte (mit Übersetzung)
		this.definedObjects = {
			noCommunication : {label: this.i18nTranslation[this.communicationStrings.noCommunicationSelectString], value: this.i18nTranslation[this.communicationStrings.noCommunicationSelect]}
		};

		// Init internal states & device states
		await this.initInternalValues();

		// start connection to GridVis
		this.connectToGridVis();
	}

	async geti18nTranslation(){
		const systemConfig = await this.getForeignObjectAsync("system.config");
		if(systemConfig){
			let lang = systemConfig.common.language;
			if(!lang){
				lang = "en";
			}
			const translationsPath = "./admin/i18n/" + lang + "/translations.json";
			return require(translationsPath);
		}
		else{
			return {};
		}
	}

	checkHistoricTimeBase(){
		for(const key in this.config.historicTimeBase){
			if(!this.config.historicTimeBase[key]){
				delete this.timeStrings[key];
			}
		}
	}

	async connectToGridVis(){
		// Reset ConnectionTimeout
		this.clearConnectionTimeout();
		this.clearAllSchedules();

		// increment the reconnect counter
		if(this.reconnectCounter > 0 || this.internalConnectionState){
			this.reconnectCounter += 1;
		}
		if(this.reconnectCounter == 1 &&  this.config.reconnectCout == 0){
			this.log.warn(`${this.communicationStrings.lastCommunicationError}: ${this.reconnectErrorString}`);
		}
		// Reset the connection indicator
		this.internalConnectionState = false;
		await this.setStateAsync("info.connection", false, true);

		// Check the configed connection settings
		// in case there is no connection to GridVis possible
		// the adapter will not work

		const projectInfo = await this.checkConnectionToRestApi(this.config.adress,this.config.port,this.config.projectname);
		if(projectInfo){
			// log just if the reconnect counter is bigger than the configed number before warning (or at startup)
			if(this.reconnectCounter > this.config.reconnectCout || this.reconnectCounter == 0){
				this.log.info(`${this.communicationStrings.connectedToGridVisVersion}: ${projectInfo.version} - ${this.communicationStrings.numberOfDevices}: ${projectInfo.numberOfDevices}`);
			}
			// Set connection established
			await this.setStateAsync("info.connection", true, true);
			this.reconnectCounter = 0;
			this.internalConnectionState = true;
			this.setStateAsync(`info.${this.internalIds.reconnectCount}`, this.reconnectCounter, true);
			this.StartCommunicationToGridVis();
		}
		else{
			if(this.reconnectCounter == this.config.reconnectCout && this.reconnectCounter != 0){ // Abfrage auf ungleich 0, da erst eine Verbindung aufgebaut sein musste bevor diese Warnung ausgegeben wird.
				this.log.warn(`${this.communicationStrings.lastCommunicationError}: ${this.reconnectErrorString}`);
			}
			if(this.reconnectCounter >= this.config.reconnectCout || this.reconnectCounter == 0){ // Abfrage auf 0, da solange keine Verbindung aufgebaut wurde immer die Warnung ausgegeben wird.
				this.log.warn(this.communicationStrings.noCommunicationSelectString);
			}
			this.setStateAsync(`info.${this.internalIds.reconnectCount}`, this.reconnectCounter, true);
			this.timeouts[this.timeoutIds.connectionTimeout] = this.setTimeout(this.connectToGridVis.bind(this),this.timeoutValues[this.timeoutIds.connectionTimeout]);
		}
	}

	async initInternalValues(){
		this.checkHistoricTimeBase();
		await this.createInternalStates();
		await this.delNotConfiguredStates();
	}


	async getAdditionalDeviceInformations(){
		let myUrl = "";
		try{
			if(this.devicesWithSerialNumber === undefined){
				this.devicesWithSerialNumber = JSON.parse(JSON.stringify(this.devices));
			}
			for(const device in this.devicesWithSerialNumber){
				myUrl = `http://${this.config.adress}:${this.config.port}/rest/1/projects/${this.config.projectname}/devices/${device}/connectiontest.json`;
				const result = await axios.get(myUrl);
				if(!isNaN(result.data.serialNumber)){
					await this.setObjectNotExistsAsync(`${this.internalIds.devices}.${device}.${this.internalIds.info}`,{
						"type": "channel",
						"common": {
							"name": "Information"
						},
						native : {},
					});

					let id = `${this.internalIds.devices}.${device}.${this.internalIds.info}.${this.internalIds.serialNumber}`;
					await this.setObjectAsync(id,{
						type:"state",
						common: {
							name: "serialnumber",
							type: "string",
							role: "value",
							read: true,
							write: false,
							def: result.data.serialNumber
						},
						native : {},
					});
					this.setStateAsync(id,result.data.serialNumber,true);

					id = `${this.internalIds.devices}.${device}.${this.internalIds.info}.${this.internalIds.firmware}`;
					await this.setObjectAsync(id,{
						type:"state",
						common: {
							name: "firmware",
							type: "string",
							role: "value",
							read: true,
							write: false,
							def: result.data.firmware
						},
						native : {},
					});
					this.setStateAsync(id,result.data.firmware,true);

					id = `${this.internalIds.devices}.${device}.${this.internalIds.info}.${this.internalIds.hardware}`;
					await this.setObjectAsync(id,{
						type:"state",
						common: {
							name: "hardware",
							type: "string",
							role: "value",
							read: true,
							write: false,
							def: result.data.hardware
						},
						native : {},
					});
					this.setStateAsync(id,result.data.hardware,true);
				}
				else{
					delete this.devicesWithSerialNumber[device];
				}
			}
		}
		catch(error){
			if(this.internalConnectionState){
				this.log.debug(`${error} after sending ${myUrl}`);
				this.reconnectErrorString = `${error} after sending ${myUrl}`;
				this.connectToGridVis();
			}
		}
	}

	clearConnectionTimeout(){
		if(this.timeouts[this.timeoutIds.connectionTimeout]){
			this.clearTimeout(this.timeouts[this.timeoutIds.connectionTimeout]);
			delete this.timeouts[this.timeoutIds.connectionTimeout];
		}
	}

	// Clear all schedules, if there are some
	clearAllSchedules(){
		for(const cronJob in this.cronJobs)
		{
			schedule.cancelJob(this.cronJobs[cronJob]);
			delete this.cronJobs[cronJob];
		}
	}

	// Clear all Timeouts, if there are some
	clearAllTimeouts(){
		for(const myTimeout in this.timeouts)
		{
			this.clearTimeout(this.timeouts[myTimeout]);
			delete this.timeouts[myTimeout];
		}
	}

	StartCommunicationToGridVis()
	{
		// create schedulejobs and do initalize reading
		this.createScheduleJobs();
		this.getAdditionalDeviceInformations();
		this.readOnlineValues();
		this.readHistoricValues();
	}

	// creates internal states
	async createInternalStates(){
		// Parse ans asign online values
		for(const index in this.config.onlineDeviceTable){
			if(this.config.onlineDeviceTable[index][this.internalIds.onlineDevices] != this.i18nTranslation[this.communicationStrings.noCommunicationSelect]){
				const configedOnlineDevices = JSON.parse(this.config.onlineDeviceTable[index][this.internalIds.onlineDevices]);
				const configedOnlineValues = JSON.parse(this.config.onlineDeviceTable[index][this.internalIds.onlineValues]);
				if(configedOnlineDevices && configedOnlineValues){
					const deviceId = configedOnlineDevices.id;
					if(!this.devices[deviceId]){
						this.devices[deviceId] = {};
						this.devices[deviceId].deviceName = configedOnlineDevices.deviceName;
						this.devices[deviceId].type = configedOnlineDevices.type;
					}
					// Create historic Values structure (in case if its not created or device is created in historicValues)
					if(!this.devices[deviceId].onlineValues){
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
		}

		// Create onlinevalue structur
		for(const device in this.devices){
			if(this.devices[device].onlineValues){
				for(const value in this.devices[device].onlineValues){
					for(const type in this.devices[device].onlineValues[value].type){

						// Create device folder (SetObject used in case the Device  type changes with changing project)
						let iconPath = this.defaultIcon;
						if(this.presentIcons[this.devices[device].type]){
							iconPath = this.presentIcons[this.devices[device].type];
						}
						await this.setObjectAsync(`${this.internalIds.devices}.${device}`,{
							type:"device",
							common:{
								name: this.devices[device].deviceName,
								icon: `icons/${iconPath}`,
							},
							native : {},
						});

						// create onlinevalue folder
						await this.setObjectNotExistsAsync(`${this.internalIds.devices}.${device}.${this.internalIds.onlineValues}`,{
							type:"channel",
							common:{
								name: this.i18nTranslation[this.translationIds.onlineValues]
							},
							native : {},
						});

						// create value channel
						let channelName = this.devices[device].onlineValues[value].valueName;
						if(value == this.internalIds.globalValue){
							channelName = this.internalIds.globalValue;
						}
						else if(value == this.internalIds.userDefined){
							channelName = this.internalIds.userDefined;
						}
						await this.setObjectNotExistsAsync(`${this.internalIds.devices}.${device}.${this.internalIds.onlineValues}.${value}`,{
							type:"channel",
							common:{
								name: channelName
							},
							native : {},
						});

						// create value state
						await this.setObjectNotExistsAsync(`${this.internalIds.devices}.${device}.${this.internalIds.onlineValues}.${value}.${type}`,{
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


		// Parse and asign historic values
		for(const index in this.config.historicDeviceTable){
			if(this.config.historicDeviceTable[index][this.internalIds.historicDevices] != this.i18nTranslation[this.communicationStrings.noCommunicationSelect]){
				const configedHistoricDevices = JSON.parse(this.config.historicDeviceTable[index][this.internalIds.historicDevices]);
				const configedHistoricValues = JSON.parse(this.config.historicDeviceTable[index][this.internalIds.historicValues]);
				if(configedHistoricDevices && configedHistoricValues){
					const deviceId = configedHistoricDevices.id;
					if(!this.devices[deviceId]){
						this.devices[deviceId] = {};
						this.devices[deviceId].deviceName = configedHistoricDevices.deviceName;
						this.devices[deviceId].type = configedHistoricDevices.type;
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
						id: configedHistoricValues.id // special parameter (in reality above the value)
					};
				}
			}
		}

		// Create historic value structure
		for(const device in this.devices){
			if(this.devices[device].historicValues){
				for(const value in this.devices[device].historicValues){
					for(const type in this.devices[device].historicValues[value].type){

						// Create device folder (SetObject used in case the Device  type changes with changing project)
						let iconPath = this.defaultIcon;
						if(this.presentIcons[this.devices[device].type]){
							iconPath = this.presentIcons[this.devices[device].type];
						}
						await this.setObjectAsync(`${this.internalIds.devices}.${device}`,{
							type:"device",
							common:{
								name: this.devices[device].deviceName,
								icon: `icons/${iconPath}`,
							},
							native : {},
						});

						// create historic value folder
						await this.setObjectNotExistsAsync(`${this.internalIds.devices}.${device}.${this.internalIds.historicValues}`,{
							type:"channel",
							common:{
								name: this.i18nTranslation[this.translationIds.historicValues]
							},
							native : {},
						});

						// create historic value channel
						let channelName = this.devices[device].historicValues[value].valueName;
						if(value === this.internalIds.globalValue){
							channelName = this.internalIds.globalValue;
						}
						else if(value == this.internalIds.userDefined){
							channelName = this.internalIds.userDefined;
						}
						await this.setObjectNotExistsAsync(`${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}`,{
							type:"channel",
							common:{
								name: channelName
							},
							native : {},
						});

						// create value state
						for(const timeBase in this.timeStrings){
							await this.setObjectNotExistsAsync(`${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings[timeBase]}`,{
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

		// Subscribe trigger state
		this.subscribeStatesAsync(`${this.internalIds.devices}.${this.internalIds.readValuesTrigger}`);
	}

	// deletes not configured states
	async delNotConfiguredStates()
	{
		// Get all objects in the adapter (later)
		this.AdapterObjectsAtStart = await this.getAdapterObjectsAsync();
		let activeString = "";
		for(const device in this.devices){
			activeString = `${this.namespace}.${this.internalIds.devices}.${device}`;
			delete this.AdapterObjectsAtStart[activeString];
			if(this.devices[device].onlineValues){
				for(const value in this.devices[device].onlineValues){
					activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.onlineValues}.${value}`;
					delete this.AdapterObjectsAtStart[activeString];
					for(const type in this.devices[device].onlineValues[value].type){
						activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.onlineValues}.${value}.${type}`;
						delete this.AdapterObjectsAtStart[activeString];
					}
				}
				activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.onlineValues}`;
				delete this.AdapterObjectsAtStart[activeString];
			}
			if(this.devices[device].historicValues){
				for(const value in this.devices[device].historicValues){
					activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}`;
					delete this.AdapterObjectsAtStart[activeString];
					for(const type in this.devices[device].historicValues[value].type){
						activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings.today}`;
						delete this.AdapterObjectsAtStart[activeString];
						activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings.yesterday}`;
						delete this.AdapterObjectsAtStart[activeString];
						activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings.thisWeek}`;
						delete this.AdapterObjectsAtStart[activeString];
						activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings.lastWeek}`;
						delete this.AdapterObjectsAtStart[activeString];
						activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings.thisMonth}`;
						delete this.AdapterObjectsAtStart[activeString];
						activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings.lastMonth}`;
						delete this.AdapterObjectsAtStart[activeString];
						activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings.thisQuater}`;
						delete this.AdapterObjectsAtStart[activeString];
						activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings.lastQuater}`;
						delete this.AdapterObjectsAtStart[activeString];
						activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings.thisYear}`;
						delete this.AdapterObjectsAtStart[activeString];
						activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings.lastYear}`;
						delete this.AdapterObjectsAtStart[activeString];
					}
				}
				activeString = `${this.namespace}.${this.internalIds.devices}.${device}.${this.internalIds.historicValues}`;
				delete this.AdapterObjectsAtStart[activeString];
			}
		}

		// delete the general states from the array
		activeString = `${this.namespace}.${this.internalIds.devices}`;
		delete this.AdapterObjectsAtStart[activeString];
		activeString = `${this.namespace}.info`;
		delete this.AdapterObjectsAtStart[activeString];
		activeString = `${this.namespace}.info.connection`;
		delete this.AdapterObjectsAtStart[activeString];
		activeString = `${this.namespace}.info.${this.internalIds.reconnectCount}`;
		delete this.AdapterObjectsAtStart[activeString];
		activeString = `${this.namespace}.${this.internalIds.devices}.${this.internalIds.readValuesTrigger}`;
		delete this.AdapterObjectsAtStart[activeString];

		// delete the remaining states
		for(const state in this.AdapterObjectsAtStart){
			this.delObjectAsync(state);
		}
	}

	// create schedule Jobs for online and historic values
	createScheduleJobs(){
		this.cronJobs[this.cronJobIds.getAdditionalDeviceInformations] = schedule.scheduleJob(this.cronJobValues.getAdditionalDeviceInformations,this.getAdditionalDeviceInformations.bind(this));
		this.cronJobs[this.cronJobIds.refreshOnlineCronJob] = schedule.scheduleJob(this.config.refreshOnlineCronJob,this.readOnlineValues.bind(this));
		this.cronJobs[this.cronJobIds.refreshHistoricCronJob] = schedule.scheduleJob(this.config.refreshHistoricCronJob,this.readHistoricValues.bind(this));
	}

	// read out all configed online values
	async readOnlineValues(){
		// create url to read out onlinevalues
		let myUrl = "";
		let firstValueReached = false;
		for(const device in this.devices){
			if(this.devices[device].onlineValues){
				if(myUrl == ""){
					myUrl = `http://${this.config.adress}:${this.config.port}/rest/1/projects/${this.config.projectname}/onlinevalues/.json?`;
				}
				for(const value in this.devices[device].onlineValues){
					if(firstValueReached){
						myUrl += `&`;
					}
					firstValueReached = true;
					myUrl += `value=${device};${value};`;
					let firstTypeReached = false;
					for(const type in this.devices[device].onlineValues[value].type){
						if(firstTypeReached){
							myUrl += `,`;
						}
						firstTypeReached = true;
						myUrl += `${type}`;
					}
				}
			}
		}

		//check for Url
		if(myUrl != ""){
			// send request to gridvis and write a valid data into the internal state
			this.log.silly(`${myUrl} was send to gridVis`);
			try{
				const result = await axios.get(myUrl,{timeout: this.config.timeout});
				this.log.silly(`result.data: ${JSON.stringify(result.data)}`);
				if(result.status == 200){
					for(const device in this.devices){
						if(this.devices[device].onlineValues){
							for(const value in this.devices[device].onlineValues){
								for(const type in this.devices[device].onlineValues[value].type){
									if((result.data.value[`${device}.${value}.${type}`] || result.data.value[`${device}.${value}.${type}`] == 0) && !isNaN(result.data.value[`${device}.${value}.${type}`])){ // Prüfung auf undgleich NaN, oder 0
										this.setStateAsync(`${this.internalIds.devices}.${device}.${this.internalIds.onlineValues}.${value}.${type}`,result.data.value[`${device}.${value}.${type}`],true);
									}
								}
							}
						}
					}
				}
			}
			catch(error){
				if(this.internalConnectionState){
					this.log.debug(`${error} after sending ${myUrl}`);
					this.reconnectErrorString = `${error} after sending ${myUrl}`;
					this.connectToGridVis();
				}
			}
		}
	}

	// red out all configed historic values
	async readHistoricValues(){
		this.log.debug("read out historic data started");
		// create url to read out historic values
		let myUrl = "";
		try{
			for(const device in this.devices){
				if(this.devices[device].historicValues){
					for(const value in this.devices[device].historicValues){
						for(const type in this.devices[device].historicValues[value].type){
							for(const timeBase in this.timeStrings){
								myUrl = `http://${this.config.adress}:${this.config.port}/rest/1/projects/${this.config.projectname}/devices/${device}/hist/energy/`;
								myUrl += `${value}/`;
								myUrl += `${type}/.json?start=NAMED_${this.timeStrings[timeBase]}&end=NAMED_${this.timeStrings[timeBase]}`;
								this.log.silly(`${myUrl} was send to gridVis`);
								const result = await axios.get(myUrl,{timeout: this.config.timeout});
								this.log.silly(`result.data: ${JSON.stringify(result.data)}`);
								if(result.status == 200){		// OK => write data into internal state
									if((result.data.energy || result.data.energy == 0) && !isNaN(result.data.energy)){ // Prüfung auf undgleich NaN, oder 0
										this.setStateAsync(`${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings[timeBase]}`,result.data.energy,true);
									}
								}
								else if(result.status == 204){		// no content write 0 into internal state
									this.setStateAsync(`${this.internalIds.devices}.${device}.${this.internalIds.historicValues}.${value}.${type}_${this.timeStrings[timeBase]}`,0,true);
								}
							}
						}
					}
				}
			}
		}
		catch(error){
			if(this.internalConnectionState){
				this.log.debug(`${error} after sending ${myUrl}`);
				this.reconnectErrorString = `${error} after sending ${myUrl}`;
				this.connectToGridVis();
			}
		}
		this.log.debug("read out historic data finished");
	}

	// Check the connection to GridVis
	async checkConnectionToRestApi(adress,port,projectname){
		try{
			let myUrl = `http://${adress}:${port}/rest/1/projects/${projectname}.json?`;
			this.log.debug(`${myUrl} was send to gridVis to check connection and number of devices`);
			const result = await axios.get(myUrl,{timeout: this.config.timeout});
			if(result){
				this.log.debug(`result.data: ${JSON.stringify(result.data)}`);
				if(result.data.status && result.data.status == this.communicationStrings.ready){
					myUrl = `http://${adress}:${port}/rest/common/info/version/full.json?`;
					this.log.debug(`${myUrl} was send to gridVis to check version`);
					const version = await axios.get(myUrl,{timeout: this.config.timeout});
					if(version){
						this.log.debug(`result.data: ${JSON.stringify(version.data)}`);
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
		catch (error){
			this.log.debug(error);
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
			this.clearAllSchedules();

			// Clear Timeouts
			this.clearAllTimeouts();

			callback();
		} catch (error) {
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
				try{ // using try catch in case of not undelining projectInfo.version as wrong type
					const projectInfo = await this.checkConnectionToRestApi(obj.message.adress,obj.message.port,obj.message.projectname);
					if(projectInfo){
						this.configConnection.adress = obj.message.adress;
						this.configConnection.port = obj.message.port;
						this.configConnection.projectname = obj.message.projectname;
						this.sendTo(obj.from, obj.command, `${this.i18nTranslation[this.communicationStrings.communicationOk]} ${projectInfo.version} - ${this.i18nTranslation[this.communicationStrings.numberOfDevices]}: ${projectInfo.numberOfDevices}`, obj.callback);
					}
					else{
						this.configConnection = {};
						this.sendTo(obj.from, obj.command, this.i18nTranslation[this.communicationStrings.noCommunication], obj.callback);
					}
				}
				catch(error){
					this.configConnection = {};
					this.sendTo(obj.from, obj.command, this.i18nTranslation[this.communicationStrings.noCommunication], obj.callback);
				}
				break;

			// in case the connection is ok get devices for online and historic configuration (same devices)
			// send the result array back to the select in config
			case "getDevices":
				if(this.configConnection.port){
					try{
						const myUrl = `http://${this.configConnection.adress}:${this.configConnection.port}/rest/1/projects/${this.configConnection.projectname}/devices.json?`;
						this.log.silly(`${myUrl} is send to get Devices`);
						result = await axios.get(myUrl,{timeout: this.config.timeout});
						this.log.silly(`result.data: ${JSON.stringify(result.data)}`);
						for(const element in result.data.device){
							const label = result.data.device[element].name + "  - Device ID: " + result.data.device[element].id;
							const value = `{"id":${result.data.device[element].id},"deviceName":"${result.data.device[element].name}","type":"${result.data.device[element].type}"}`;
							devices[myCount] = {label: label,value: value};
							myCount ++;
						}
						this.sendTo(obj.from, obj.command, devices, obj.callback);
					}
					catch(error){
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
						const myUrl = `http://${this.configConnection.adress}:${this.configConnection.port}/rest/1/projects/${this.configConnection.projectname}/devices/${obj.message.id}/online/values.json?`;
						this.log.silly(`${myUrl} is send to get online values`);
						result = await axios.get(myUrl,{timeout: this.config.timeout});
						this.log.silly(`result.data: ${JSON.stringify(result.data)}`);
						const myValues = [];
						myCount = 0;
						for(const values in result.data.valuetype){
							let label = result.data.valuetype[values].valueName;
							if(result.data.valuetype[values].valueName != result.data.valuetype[values].typeName){
								label += " " + result.data.valuetype[values].typeName;
							}
							const keys = Object.keys(result.data.valuetype[values]).sort();
							const mapedresult = keys.map(myKey => `"${myKey}":"${result.data.valuetype[values][myKey]}"`);
							const value = "{" + mapedresult.join(",") + "}";
							myValues[myCount] = {label: label, value: value};
							myCount ++;
						}
						this.sendTo(obj.from, obj.command, myValues, obj.callback);
					}
					catch(error){
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
						const myUrl = `http://${this.configConnection.adress}:${this.configConnection.port}/rest/1/projects/${this.configConnection.projectname}/devices/${obj.message.id}/hist/values.json?`;
						this.log.silly(`${myUrl} is send to get historic values`);
						result = await axios.get(myUrl,{timeout: this.config.timeout});

						this.log.silly(`result.data: ${JSON.stringify(result.data)}`);
						const myValues = [];
						myCount = 0;
						for(const values in result.data.value){
							// Check for unit Wh || m³
							if(result.data.value[values].valueType.unit == "Wh" || result.data.value[values].valueType.unit == "m³"){
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
					catch(error){
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