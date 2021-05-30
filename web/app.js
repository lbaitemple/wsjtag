(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
'use strict';

const lus = {
    LIBUSB_REQUEST_TYPE_VENDOR: (0x02 << 5),
    LIBUSB_RECIPIENT_DEVICE: 0,
    LIBUSB_ENDPOINT_IN: 0x80,
    LIBUSB_ENDPOINT_OUT: 0
};

module.exports = {
    FTDI_REQTYPE_OUT: lus.LIBUSB_REQUEST_TYPE_VENDOR |
        lus.LIBUSB_RECIPIENT_DEVICE |
        lus.LIBUSB_ENDPOINT_OUT,
    FTDI_IFC_A: 1,
    FTDI_IFC_B: 2,
    FTDI_CTL_RESET:         0,
    FTDI_CTL_SET_BITMODE:   0x0b,
    FTDI_CTL_SET_EVENT_CH:  0x06,
    FTDI_CTL_SET_ERROR_CH:  0x07
};

},{}],2:[function(require,module,exports){
'use strict';

module.exports = f => {
    const div = Math.round(30e6 / f) - 1;
    return [
        0x85, // loopback off
        0x8a, // disable clock/5
        0x97, // Turn off adaptive clocking (may be needed for ARM)
        0x8D, // Disable three-phase clocking
        0x86,
        div & 0xff,
        (div >> 8) & 0xff
    ];
};

},{}],3:[function(require,module,exports){
'use strict';

// Set initial states of the MPSSE interface
// - low byte, both pin directions and output values
// Pin name Signal  Direction   Initial State
//  ADBUS0  TCK/SK  output  1   low     0
//  ADBUS1  TDI/DO  output  1   low     0
//  ADBUS2  TDO/DI  input   0           0
//  ADBUS3  TMS/CS  output  1   low     0
//  ADBUS4  ACT     output  1   low     0
//  ADBUS5  GPIOL1  input   0           0
//  ADBUS6  GPIOL2  input   0           0
//  ADBUS7  GPIOL3  input   0           0

// Set initial states of the MPSSE interface
// - high byte, both pin directions and output values
// Pin name Signal  Direction   Initial State
//  ACBUS0  GPIOH0  input   0           0
//  ACBUS1  GPIOH1  input   0           0
//  ACBUS2  GPIOH2  input   0           0
//  ACBUS3  GPIOH3  input   0           0
//  ACBUS4  GPIOH4  input   0           0
//  ACBUS5  GPIOH5  input   0           0
//  ACBUS6  GPIOH6  input   0           0
//  ACBUS7  GPIOH7  input   0           0

module.exports = [0x80, 0b00000000, 0b00011011]; // ADBUS

},{}],4:[function(require,module,exports){
'use strict';

const ftd = require('./ftdi-flags');
// const mv = require('./ftdi-jtag-state-change');
const initMPSSE = require('./ftdi-mpsse-init');
const fdiv = require('./ftdi-mpsse-divider');
// const str2buf = require('./str2buf');

module.exports = dev => {

    const cfgOut = async (bRequest, wValue) => {
        await dev.controlTransferOut({
            requestType: 'vendor', // ftd.FTDI_REQTYPE_OUT,
            recipient: 'interface', // ftd.FTDI_IFC_A,
            request: bRequest,  // vendor-specific request: enable channels
            value: wValue,  // 0b00010011 (channels 1, 2 and 5)
            index: 0
        });
    };

    const datOut = async buf => {
        if (buf === undefined) { throw new Error(); }
        const len = buf.length;
        let abuf = new ArrayBuffer(len);
        let view = new Uint8Array(abuf);
        for (let i = 0; i < len; i++) {
            view[i] = buf[i];
        }
        await dev.transferOut(0, abuf);
    };

    const init = async () => {
        await cfgOut(ftd.FTDI_CTL_RESET, 0);
        await cfgOut(ftd.FTDI_CTL_SET_BITMODE, 0x0000);
        await cfgOut(ftd.FTDI_CTL_SET_BITMODE, 0x0200);
        await cfgOut(ftd.FTDI_CTL_SET_EVENT_CH, 0);
        await cfgOut(ftd.FTDI_CTL_SET_ERROR_CH, 0);
        await datOut(fdiv(30e6).concat(initMPSSE));
    };

    return {
        cfgOut: cfgOut,
        init: init
    };
};

},{"./ftdi-flags":1,"./ftdi-mpsse-divider":2,"./ftdi-mpsse-init":3}],5:[function(require,module,exports){
'use strict';

const util = require('../../lib/ftdi-webusb');

const filters = { filters: [{ vendorId: 0x09fb, productId: 0x6001, interfaceClass: 9 }]};

const btn = document.getElementById('connect');

btn.addEventListener('click', async () => {
    try{
        let dev =  await navigator.usb.requestDevice(filters);
        console.log(dev);
        dev.open();
        console.log(dev);

        dev.selectConfiguration(1);
        dev.claimInterface(dev.configuration.interfaces[0].interfaceNumber);

    } catch (e) {
        // No device was selected.
        console.log("error");
        console.log(e.message);
    }

    const setPortConfig = {
      requestType: 'vendor',
      recipient: 'device',
      request: 0x05,
      value: 0x00,
      index: 0x03
    }

    const openPort = {
      requestType: 'vendor',
      recipient: 'device',
      request: 0x06,

      value: 0x89,
      index: 0x03
    }

    const startPort = {
      requestType: 'vendor',
      recipient: 'device',
      request: 0x08,
      value: 0x00,
      index: 0x03
    }

    const closePort = {
      requestType: 'vendor',
      recipient: 'device',
      request: 0x07,
      value: 0x00,
      index: 0x03
    }

    async function close () {
      let result = await device.controlTransferOut(closePort)
      console.log('close port:', result)
      await device.releaseInterface(0)
      await device.close()
    }



    //console.log(if0);
   // const u = util(dev);
   // u.init();
   // const epIn = if0.endpoints[0]; // (0x81);
   // epOut = if0.endpoints[1]; //(0x02);

/*    const dev = await navigator.usb.requestDevice(filters);
    await dev.open();
    if (dev.configuration === null) {
        await dev.selectConfiguration(1);
    }
    const if0 = dev.configurations[0].interfaces[0];
    if (!if0.claimed) {
        await dev.claimInterface(0);
    }
    console.log(if0);
    const u = util(dev);
    await u.init();
    const epIn = if0.endpoints[0]; // (0x81);
    epOut = if0.endpoints[1]; //(0x02);
    */

});

/* global navigator document */
const btnflash = document.getElementById('flash');

btnflash.addEventListener('click', async () => {
  let button = document.getElementById('flash')
  console.log("flash....");
});
},{"../../lib/ftdi-webusb":4}]},{},[5]);
