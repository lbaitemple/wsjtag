# wsjtag

Fow windows user, you will need to install usbblaster driver

https://www.terasic.com.tw/wiki/File:Usb_blaster_q16.1.zip

Also, you will need to install libusb
https://avrhelp.mcselec.com/index.html?libusb.htm


In Webstrom terminal windows, please type the following commands
```
npm install yargs request progress usb
npm install @drom/eslint-config eslint mocha nyc
```


TO run
```
node  svf2ftdi.js -n 91d28408 -p -f lab1_top.svf 
```
