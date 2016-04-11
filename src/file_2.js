#!/usr/bin/env node

/**
 * Данный файл является частю системы сбора статистики работы ip-телефонии
 * компании ООО "Агентсво связи".
 *
 * В данном файле реализован функционал сервиса аграгации логов серверов телефонии (Asterisk).
 *
 * Created by BelirafoN <belirafon@gmail.com> on 10/02/16
 */

'use strict';

const path = require('path');
process.env['NODE_CONFIG_DIR'] = path.join(__dirname, '../config');

const MongoClient = require('mongodb').MongoClient;
const config = require('config');
const colors = require('colors/safe');
const co = require('co');
const statusAggregator = require('../amiLogsAggregations/userEventsAggregator')();
const dialAggregator = require('../amiLogsAggregations/dialEventsAggregator')({
    threads: 'auto',
    chunk: 200,
    spawnOutput: false
});
const joinAggregator = require('../amiLogsAggregations/joinEventsAggregator')({
    threads: 'auto',
    chunk: 50,
    spawnOutput: false
});
const dbCleaner = require('../amiLogsAggregations/dbCleaner/index.js')();

let dbs = [],
    serviceIsRun = true,
    tasks = [
        {
            name: 'statuses',
            task: statusAggregator,
            message: 'aggregate statuses of agents'
        },
        {
            name: 'dial',
            task: dialAggregator,
            message: 'aggregate dial-events',
            params(){
                return [null, Date.now() + config.get('services.eventsAggregation.dialShift')];
            }
        },
        {
            name: 'join',
            task: joinAggregator,
            message: 'aggregate join-events',
            params(){
                return [null, Date.now() + config.get('services.eventsAggregation.joinShift')];
            }
        }
    ];

co(function* (){
    let maxTimeoutDelay = config.get('services.eventsAggregation.delay');

    while(serviceIsRun){

        try{
            let duration = yield aggregator(tasks),
                delay = maxTimeoutDelay - (parseInt(duration, 10) || 0);

            if(delay > 0){ yield sleep(delay); }

        }catch (error){
            console.log(error.stack);
        }
    }

    process.on('SIGINT', () => {
        console.log('process received "SIGINT" signal.');
        serviceIsRun = false;
    })

});

/**
 *
 * @param delay
 * @returns {Promise}
 */
function sleep(delay){
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 *
 * @returns {Promise.<T>}
 */
function aggregator(tasks){

    return co(function* (){
        console.log(colors.green(`Events aggregation started at ${new Date().toJSON()}`));
        console.log(colors.green('-'.repeat(15)));

        let startTime = Date.now(),
            stepStartTime = null,
            timings = {};

        let statisticDb = yield MongoClient.connect(config.get('mongodb.local.statistic'));
        dbs.push(statisticDb);

        for(let i = 0; i < tasks.length; i++){
            stepStartTime = Date.now();
            console.log(colors.green(`[${i + 1}] - ${tasks[i].message}...`));

            if(tasks[i].params){

                if(Array.isArray(tasks[i].params)){
                    yield tasks[i].task.run.apply(tasks[i].task, tasks[i].params);

                }else if(tasks[i].params instanceof Function){
                    yield tasks[i].task.run.apply(tasks[i].task, tasks[i].params.call(tasks[i]));

                }else{ throw new TypeError('Params must be Array or Function'); }

            }else{
                yield tasks[i].task.run();
            }

            console.log(colors.green(`[${i + 1}] - complete.`));
            timings[tasks[i].name] = Date.now() - stepStartTime;
        }

        console.log(colors.green('-'.repeat(15)));
        console.log(colors.green(`Aggregation finished. Duration: ${Date.now() - startTime} ms.`));

        yield statisticDb.collection('_journal').insert({
            event: 'eventsAggregation',
            startTime: startTime,
            startTimeH: new Date(startTime).toJSON(),
            duration: Date.now() - startTime,
            tasks: timings,
            memoryUsage: process.memoryUsage()
        });

        stepStartTime = Date.now();
        yield dbCleaner.run(null, startTime, config.get('dbCleaner.timeShift'));

        let amiDb = yield MongoClient.connect(config.get('mongodb.local.ami'));
        dbs.push(amiDb);

        yield statisticDb.collection('_journal').insert({
            event: 'eventsClearing',
            startTime: stepStartTime,
            startTimeH: new Date(stepStartTime).toJSON(),
            duration: Date.now() - stepStartTime,
            collectionSize: yield amiDb.collection('events').find({}).count()
        });
        console.log(colors.green(`Done. Duration: ${Date.now() - stepStartTime} ms`));

        return Date.now() - startTime;
    })
        .catch(error => error)
        .then(duration => {
            dbs.forEach(db => db && db.close());
            dbs = [];
            if(duration instanceof Error){ throw duration; }
            return duration;
        });
}