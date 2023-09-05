#!/usr/bin/env node
'use strict';
//import { Buffer } from 'node:buffer';

// const tty = require('tty');
const fs = require('fs');
const path = require('path');
const readLine = require('readline');
const http = require('http');
const yargs = require('yargs');
const request = require('request');
const svf = require('./lib/svf-stream');

const usb = require('usb');
const vendorId = 0x09fb;
const productId = 0x6001;

function initialize_usb_blaster()  {
    /**
     *
    const devices = usb.getDeviceList();
    let match = devices.find((device) => device.deviceDescriptor.idVendor.toString(16) === "9fb" && device.deviceDescriptor.idProduct.toString(16) === "6001")
    if (match)
        console.log("Required USB device found: Vendor 0x09fb Product 0x6001");
    else
        throw new Error("Required USB device not found: Vendor 0x09fb Product 0x6001");
     *
    **/

    let device = usb.findByIds(vendorId, productId);
    if (!device) {
        throw new Error('FTDI JTAG device not found: Vendor 0x' + vendorId.toString(16) + ' Product 0x' + productId.toString(16));
    } else {
        console.log('FTDI JTAG device found: Vendor 0x' + vendorId.toString(16) + ' Product 0x' + productId.toString(16));
    }

    device.open();

    let iface = device.interfaces[0];
    iface.claim();

    let dataToSend = Buffer.from([0x00, 0x00, 0x00]);

    let endpoint = iface.endpoint(0);
    for (const ep of iface.endpoints) {
        if (ep.direction === 'out') {
            endpoint = ep;
            break;
        }
    }

    endpoint.transfer(dataToSend, (error) => {
        if (error) {
            console.error('Error sending data: ', error);
        } else {
            console.log('Data sent successfully.');
        }

        // Release the interface and close the device
        iface.release();
        device.close();
    });
}

const options = yargs
    .option('file', {
        alias: 'f',
        type: 'string',
        describe: 'input SVF file name'
    })
    .option('url', {
        alias: 'u',
        type: 'string',
        describe: 'input SVF URL'
    })
    .option('serial-number', {
        alias: 'n',
        type: 'string',
        describe: 'FTDI serial number'
    })
    .option('serial-div', {
        alias: 'd',
        type: 'string',
        describe: 'FTDI serial number divisor'
    })
    .option('freq', {
        alias: 'h',
        type: 'number',
        describe: 'FTDI TCK frequency',
        default: 30e6
    })
    .option('channel', {
        alias: 'c',
        type: 'number',
        describe: 'FTDI channel',
        default: 0
    })
    .option('progress', {
        alias: 'p',
        boolean: true,
        describe: 'Show progress bar'
    })
    .version()
    .help()
    .argv;

let source;
initialize_usb_blaster();

if (options.file) {
    const fileName = path.resolve(process.cwd(), options.file);
    source = fs.ReadStream(fileName);
} else
if (options.url) {
    source = request
        .get(options.url)
        .on('error', function (error) {
            throw new Error(error);
        })
        .on('response', function (response) {
            // const contentType = response.headers['content-type']
            //     .split(';').map(e => e.trim());
            if (response.statusCode !== 200 /* || contentType[0] === 'text/html' */) {
                throw new Error(JSON.stringify({
                    status: response.statusCode,
                    'content-type': response.headers['content-type']
                }));
            }
            // console.log(response.statusCode, response.headers['content-type']);
        });
} else
if (process.stdin.isTTY) {
    source = process.stdin.setEncoding('ascii');
}

const { Readable } = require('stream');

if (source) {
    const jtag = ftdi(options);
    const s1 = svf(jtag);
    source.pipe(s1);
} else {
    yargs.showHelp();
}