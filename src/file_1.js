/**
 * Данный файл является частю системы анализа статистики работы call-центра
 * компании ООО "Агентсво связи".
 *
 * В данном файле реализован функционал посчета рабочего времени оператора call-центра по пулу
 * входящих событий сервера телефонии (Asterisk).
 *
 * Created by BelirafoN <belirafon@gmail.com> on 21/02/16
 */

'use strict';
const errors = require('./errors');

/**
 *  Agent work time calculator
 */
class AgentWorkTime{

    constructor(userId, options){
        this.userId = userId;
        this.options = Object.assign({
            timeFieldName: 'statusTime',
            statusNameFieldName: 'statusName',
            statusIdFieldName: 'statusId',
            deviceIdFieldName: 'deviceId',
            throws: true,
            checkDeviceId: true
        }, options);

        this.currentDeviceId = null;
        this.firstStatusTime = null;
        this.lastStatusTime = null;
        this.lastLoginTime = null;
        this.lastStatusEvent = null;

        this.beforeLoginStatus = null;
        this._currentStatus = null;
        this.nextStatus = null;

        this.devices = new Set();

        this.timers = {
            "available": 0,
            "meeting": 0,
            "do not disturb": 0,
            "break": 0,
            "out to lunch": 0,
            "logout": 0,
            "in call": 0,
            "login": 0
        };

        this.eventCounters = {
            "available": 0,
            "meeting": 0,
            "do not disturb": 0,
            "break": 0,
            "out to lunch": 0,
            "logout": 0,
            "login": 0,
            "in call begin": 0,
            "in call end": 0
        };

        this.statusCounters = {
            "available": 0,
            "meeting": 0,
            "do not disturb": 0,
            "break": 0,
            "out to lunch": 0,
            "logout": 0,
            "login": 0,
            "in call begin": 0,
            "in call end": 0
        };

        this._isLoginNow = true;
        this._isCallingNow = false;
        this._isAvailableNow = false;

        this._resetedBeforeLogin = false;
    }

    set currentStatus(status){
        this._currentStatus = status;
        this._incStatusCounter(status);
    }

    get currentStatus(){
        return this._currentStatus;
    }

    /**
     *
     * @param event
     */
    addEvent(event){
        this._checkUserId(event);
        this._checkStatusTime(event);
        this.options.checkDeviceId && this._checkDeviceId(event);
        this._incEventCounter(event);

        this.lastStatusEvent = Object.assign({}, event);
        this._calcTime(event);

        if(this._isLoginNow && event[this.options.deviceIdFieldName]){
            this.devices.add(event[this.options.deviceIdFieldName]);
        }

        if(!this.firstStatusTime){
            this.firstStatusTime = event[this.options.timeFieldName];
        }
        return this;
    }

    /**
     *
     * @returns {{userId: *, currentDeviceId: (null|*), currentStatus: *, isLoginNow: boolean, isCallingNow: boolean, isAvailableNow: (boolean|*), eventCounters: *, timers: *, devices: Array, firstStatusTime: (null|*), firstStatusTimeH: *, lastStatusTime: (null|*), lastStatusTimeH: *, lastLoginTime: (null|*), lastLoginTimeH: *}}
     */
    getResults(){
        if(!this.firstStatusTime) throw new errors.WorkTimeIsEmptyError('Work time is empty.');

        let result = {
            userId: this.userId,
            currentDeviceId: this.currentDeviceId,
            currentStatus: this.currentStatus ? {
                id: this.currentStatus.id,
                name: this.currentStatus.name
            } : null,
            isLoginNow: this._isLoginNow,
            isCallingNow: this._isCallingNow,
            isAvailableNow: this._isAvailableNow,
            eventCounters: Object.assign({}, this.eventCounters),
            statusCounters: Object.assign({}, this.statusCounters),
            timers: Object.assign({}, this.timers),
            devices: Array.from(this.devices),
            firstStatusTime: this.firstStatusTime,
            firstStatusTimeH: this.firstStatusTime ? new Date(this.firstStatusTime).toJSON() : null,
            lastStatusTime: this.lastStatusTime,
            lastStatusTimeH: this.lastStatusTime ? new Date(this.lastStatusTime).toJSON() : null,
            lastLoginTime: this.lastLoginTime,
            lastLoginTimeH: this.lastLoginTime ? new Date(this.lastLoginTime).toJSON() : null
        };

        result.timers['login'] = Object.keys(result.timers).reduce((sum, currentKey) => {
            if(currentKey != 'logout'){
                sum += result.timers[currentKey];
            }
            return sum;
        }, 0);

        return result;
    }

    /**
     *
     * @param event
     * @private
     */
    _calcTime(event){
        let eventStatusId = parseInt(event[this.options.statusIdFieldName], 10),
            newStatus = this._getStatusObj(event);

        switch (eventStatusId){

            case 1: // available:
            case 2: // meeting
            case 3: // dnd
            case 4: // break
            case 5: // out to lunch
                if(!this._isLoginNow){
                    this.beforeLoginStatus = newStatus;
                    return;
                }

                if(this.currentStatus && this.currentStatus.id === newStatus.id){ return; }

                if(this._isCallingNow){
                    this.nextStatus = newStatus;

                }else{
                    this._incTimer(this.currentStatus, newStatus);
                    this.currentStatus = newStatus;
                    this._isAvailableNow = newStatus.id === 1 /* available */;
                    this.lastStatusTime = newStatus.time;
                }

                break;

            case 6: // logout
                this._logoutHandler(event, newStatus);
                break;

            case 7: // login
                this._loginHandler(event, newStatus);
                break;

            case 8: // call begin
                this._callStartHandler(event, newStatus);
                break;

            case 9: // call end
                this._callStopHandler(event, newStatus);
                break;

            default: break;
        }
    }

    /**
     *
     * @param event
     * @param newStatus
     * @private
     */
    _callStartHandler(event, newStatus){
        if(!this._isLoginNow){
            this.beforeLoginStatus = newStatus;
            return;
        }

        if(this._isLoginNow && this.currentStatus && this.currentStatus.id === 8 /* call begin */){ return; }

        this._incTimer(this.currentStatus, newStatus);
        this.nextStatus = this.currentStatus || {
                name: 'available',
                time: newStatus.time,
                id: 1
            };
        this.currentStatus = newStatus;
        this._isCallingNow = true;
        this._isAvailableNow = false;
        this.lastStatusTime = this.currentStatus.time;
    }

    /**
     * 
     * @param event
     * @param newStatus
     * @private
     */
    _callStopHandler(event, newStatus){
        if(this.currentStatus && this.currentStatus.id != 8 /* call begin */ ){ return; }

        if(!this._isLoginNow){ return; }

        this._incTimer(this.currentStatus, newStatus);

        if(this.nextStatus){
            this.currentStatus = newStatus;
            this.nextStatus.time = newStatus.time;
            this.currentStatus = this.nextStatus;
            this.nextStatus = null;

            if(this.currentStatus.id === 6){
                this._isAvailableNow = false;
                this._isLoginNow = false;
            }

        }else{
            // when nextStatus after call is null
            this.currentStatus = {
                id: 1,
                name: 'available',
                time: newStatus.time
            };
        }

        this._isCallingNow = false;
        this._isAvailableNow = this.currentStatus.id === 1 /* available */;
        this.lastStatusTime = this.currentStatus.time;
    }

    /**
     *
     * @param event
     * @param newStatus
     * @private
     */
    _loginHandler(event, newStatus){
        if(this._isLoginNow && this.lastLoginTime && this.currentStatus){ return; }

        if(this._isLoginNow && !this.lastLoginTime){

            Object.keys(this.timers).forEach(key => {
                this.timers[key] = 0;
            });

            if(this.currentStatus){
                this.beforeLoginStatus = this.currentStatus;
                this._resetedBeforeLogin = true;
            }
        }

        if(!this._isLoginNow){
            if(this.beforeLoginStatus && this.beforeLoginStatus.id === 8){
                this._incTimer(this.currentStatus, this.beforeLoginStatus);
                this._isCallingNow = true;

            }else{
                this._incTimer(this.currentStatus, newStatus);
            }

        }

        if(!this.beforeLoginStatus){
            this.currentStatus = {
                id: 1,
                name: 'available',
                time: newStatus.time
            };
            this._isAvailableNow = true;

        }else{
            if(this.beforeLoginStatus.id !== 8 /* in call begin */){
                this.beforeLoginStatus.time = newStatus.time;
            }

            if(this._resetedBeforeLogin){
                this._currentStatus = this.beforeLoginStatus;

            }else{
                this.currentStatus = this.beforeLoginStatus;
                this._resetedBeforeLogin = false;
            }

            this._isAvailableNow = this.currentStatus.id === 1 /* available */;
            this._isCallingNow = this.currentStatus.id === 8 /* in call begin */;
            this.beforeLoginStatus = null;
        }

        this._isLoginNow = true;
        this.lastLoginTime = newStatus.time;
        this.lastStatusTime = newStatus.time;
        this.currentDeviceId = event[this.options.deviceIdFieldName];
    }

    /**
     *
     * @param event
     * @param newStatus
     * @private
     */
    _logoutHandler(event, newStatus){
        if(!this._isLoginNow){ return; }

        if(this._isCallingNow){
            this.nextStatus = newStatus;

        }else{

            this._incTimer(this.currentStatus, newStatus);
            this.currentStatus = newStatus;
            this._isLoginNow = false;
            this._isAvailableNow = false;
            this.lastStatusTime = newStatus.time;
            this.currentDeviceId = null;
        }
    }

    /**
     *
     * @param oldStatus
     * @param newStatus
     * @private
     */
    _incTimer(oldStatus, newStatus) {
        if(!oldStatus || !newStatus){ return; }

        let statusName = oldStatus.name === 'in call begin' ? 'in call' : oldStatus.name;

        if (!this.timers[statusName]) {
            this.timers[statusName] = 0;
        }

        this.timers[statusName] += newStatus.time - oldStatus.time;
    }

    /**
     *
     * @param event
     * @returns {{id: *, name: string}}
     * @private
     */
    _getStatusObj(event){
        return {
            id: parseInt(event[this.options.statusIdFieldName], 10),
            name: event[this.options.statusNameFieldName].toLowerCase(),
            time: event[this.options.timeFieldName]
        };
    }

    /**
     *
     * @param event
     * @private
     */
    _incEventCounter(event){
        let eventStatusName = event[this.options.statusNameFieldName].toLowerCase();

        if(!this.eventCounters[eventStatusName]){
            this.eventCounters[eventStatusName] = 1;

        }else{
            ++this.eventCounters[eventStatusName];
        }
    }

    /**
     *
     * @param status
     * @private
     */
    _incStatusCounter(status){
        if(!status){ return; }

        if(!this.statusCounters[status.name]){
            this.statusCounters[status.name] = 1;

        }else{
            ++this.statusCounters[status.name];
        }
    };

    /**
     *
     * @param event
     * @private
     */
    _checkUserId(event){
        if(this.options.throws && this.userId && event.userId !== this.userId){
            throw new errors.UserIdIsNotMatchError(`UserId error. Expected [${this.userId}], given [${event.userId}].`);
        }
    }

    /**
     *
     * @param event
     * @private
     */
    _checkStatusTime(event){
        if(this.options.throws && this.lastStatusTime && event[this.options.timeFieldName] < this.lastStatusTime){
            throw new errors.StatusTimeChronologyError('Given status event is not sorted by time. Event: ' + JSON.stringify(event));
        }
    }

    /**
     *
     * @param event
     * @private
     */
    _checkDeviceId(event){
        if(this._isLoginNow && this.firstStatusTime && this.currentDeviceId){
            if(this.options.throws && event[this.options.deviceIdFieldName] !== this.currentDeviceId){
                throw new errors.DeviceIdMatchError(`DeviceId error. Expected [${this.currentDeviceId}], ` +
                    `given [${event[this.options.deviceIdFieldName]}].`);
            }
        }
    }
}

module.exports = AgentWorkTime;