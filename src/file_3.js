/**
 * Данный файл является частю системы анализа статистики работы ip-телефонии
 * компании ООО "Агентсво связи".
 *
 * В данном файле реализован функционал простого экспорта входящих данных в csv-файл.
 *
 * Created by BelirafoN <belirafon@gmail.com> on 24/03/16
 */

"use strict";

const path = require('path');
const fs = require('fs');
const CSV_DEFAULT_DELIMITER = ';';

module.exports = function(reportData, headerNames, file, delimiter){
    let csvDelimiter = delimiter || CSV_DEFAULT_DELIMITER,
        reportFileName = file || getFileName(reportData['queue'], reportData['date']);

    if(!/\.csv$/.test(reportFileName)){
        reportFileName += '.csv';
    }

    let reportFilePath = path.join(__dirname, `../../../storage/${reportFileName}`),
        fd = fs.openSync(reportFilePath, 'w');

    if(!Array.isArray(reportData['rows'])){
        throw new TypeError('Rows not found in report data.');
    }

    if(headerNames && Array.isArray(headerNames)){
        fs.writeSync(fd, headerNames.join(csvDelimiter) + `${csvDelimiter}\r\n`);
    }

    for(let row of reportData['rows']){
        let rowData = row;

        if(!row){ continue; }

        if(!Array.isArray(row)){
            rowData = Object.keys(row).reduce((result, key) => {
                result.push(row[key]);
                return result;
            }, []);
        }

        if(headerNames && Array.isArray(headerNames) && rowData.length != headerNames.length){

            if(rowData.length < headerNames.length){
                rowData = rowData.concat(new Array(headerNames.length - rowData.length));

            }else{
                rowData = rowData.slice(0, headerNames.length);
            }
        }

        fs.writeSync(fd, rowData.join(csvDelimiter) + `${csvDelimiter}\r\n`);
    }

    fs.closeSync(fd);
};

/**
 *
 * @param queue
 * @param date
 * @returns {string}
 */
function getFileName(queue, date){
    let queueStr = queue ? `${Array.isArray(queue) ? queue.join('_') : queue}_` : null,
        dateStr = date ? `${date.replace(/[\.]/g, '_')}_` : null;

    return `month_report_by_queues_${queueStr}${dateStr}${Date.now()}.csv`;
}