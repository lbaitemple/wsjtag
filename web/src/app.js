'use strict';

const util = require('../../lib/ftdi-webusb');
const svf = require('j../../lib/svf-stream');
const ftdi = require('../../lib/ftdi-libusb');
const jtag = ftdi(options);

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
  const s1 = svf(jtag);
  source.pipe(s1);
});