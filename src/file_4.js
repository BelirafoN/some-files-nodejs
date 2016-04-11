/**
 * Данный файл является частю системы real-time мониторинга работы call-центра
 * компании ООО "Агентсво связи".
 *
 * В данном файле реализован функционал обработки смены состояний операторов call-центра.
 *
 * Created by BelirafoN <belirafon@gmail.com> on 17/02/14
 */

"use strict";

var userStatuses = require('../user_statuses'),
    userRefreshDelay = require('config').get('userRefreshDelay');

module.exports = function(analyst, log){

    return function UserEventHandler(event){
        var tmp = null,
            value, userId, deviceId,
            isDisconnect = false;

        if(event.UserEvent.toLowerCase() === 'opinion'){
            analyst.emit('opinion', {
                opinion: event.OpinionValue,
                opinionTime: event._time,
                callerId: event.Callerid,
                userId: event.User,
                deviceId: analyst._registeredUsers[event.User] || null,
                channel2Id: event.Channel
            });
            return;
        }

        if(event.UserEvent.toLowerCase() === 'callinfonexus'){
            analyst._channelForFile[event.Channel] = event;
            return;
        }

        if(event.UserEvent === 'FOP2ASTDB'){
            value = !event.Value ? 'available' : event.Value.toLowerCase();
            userId = event.Channel.replace(/[^0-9]/g, '');
            analyst.emit('user_status', {
                userId: userId,
                deviceId: analyst._registeredUsers[userId] || null,
                statusName: value,
                statusId: userStatuses[value] || 0,
                statusTime: event._time
            });
            log && log.info(userId + ' on ' + (analyst._registeredUsers[userId] || 'nodata') + ' - ' + value + ' _time:' + event._time);
            return;
        }

        if(event.UserEvent === 'UserDeviceRemoved'){
            tmp = event.Data.split(',');
            isDisconnect = analyst._devices[tmp[1]] && analyst._devices[tmp[1]].activeChannel;

            /* logout во время активного канала (разговора) */
            if(isDisconnect && analyst._eventHandlers['Hangup']){

                analyst._eventHandlers['Hangup'].forEach(function(listener){
                    listener.call(analyst, {
                        Channel: analyst._devices[tmp[1]].activeChannel.id,
                        CallerIDNum: tmp[1],
                        Cause: '16',
                        "_time": event._time,
                        "_surrogate": true
                    });
                });
            }

            analyst.emit('user_logout', {
                userId: tmp[0],
                deviceId: tmp[1],
                statusName: 'logout',
                statusId: userStatuses['logout'],
                statusTime: event._time
            });
            delete analyst._devices[tmp[1]];
            log && log.info(tmp[0] + ' - logout on [' + tmp[1] + '] _time:' + event._time);
            analyst.refreshMembers(userRefreshDelay);
            return;
        }

        if(event.UserEvent === 'UserDeviceAdded'){
            tmp = event.Data.split(',');
            analyst.emit('user_login', {
                userId: tmp[0],
                deviceId: tmp[1],
                statusName: 'login',
                statusId: userStatuses['login'],
                statusTime: event._time
            });
            analyst._devices[tmp[1]] = {id: tmp[1]};
            analyst.isDebug && log && log.debug('[UserDeviceAdded event] Added new device id: ' + tmp[1]);
            log && log.info(tmp[0] + ' - login on [' + tmp[1] + '] _time:' + event._time);
            analyst.refreshMembers(userRefreshDelay);
        }
    }
};