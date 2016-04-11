/**
 * Данный файл является частю системы синхронного вывода информации на мониторы систем видеонаблюдения
 * компании ООО "Агентсво связи".
 *
 * В данном файле реализован функционал класса-снифера jpeg-кадров из входящего mjpeg-потока.
 *
 * Created by BelirafoN <belirafon@gmail.com> on 03/02/16
 */

'use strict';

const Transform = require('stream').Transform;

class MjpegFrameSniffer extends Transform{

    constructor(){
        super();
        this._jpegChunks = [];
        this._rawData = [];
    }

    _transform(buffer, encoding, done){
        let chunk = buffer.slice(0);

        this.emit('chunk', buffer);

        if(this._rawData.length){
            this._rawData.push(chunk);
            chunk = Buffer.concat(this._rawData);
            this._rawData = [];
        }

        let _frameStartIndex = -1,
            _frameStopIndex = -1,
            chunkLength = chunk.length;

        for (var i = 0; i < chunkLength; i++) {

            if (chunk[i] === 0xFF && i < chunkLength - 1 && chunk[i + 1] === 0xD8){
                _frameStartIndex = i++;
                continue;
            }

            if (chunk[i] === 0xFF && i < chunkLength - 1 && chunk[i + 1] === 0xD9){
                _frameStopIndex = ++i + 1;
                 this._jpegChunks.push(chunk.slice((!~_frameStartIndex ? 0 : _frameStartIndex), _frameStopIndex));

                this.emit('frame', Buffer.concat(this._jpegChunks));

                if(_frameStopIndex < chunkLength - 1){
                    this._rawData.push(chunk.slice(_frameStopIndex));
                }

                this._jpegChunks = [];
                _frameStartIndex = _frameStopIndex = -1;

                break;
            }
        }

        if(~_frameStartIndex && !~_frameStopIndex){
            this._jpegChunks.push(chunk.slice(_frameStartIndex));
        }

        done(null, null);
    }

}

module.exports = MjpegFrameSniffer;