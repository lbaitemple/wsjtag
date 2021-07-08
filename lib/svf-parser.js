'use strict';

const rules = require('./svf-rules');

module.exports = jtag => {
    let tail = '';
    let state = 'space';
    let firstChunk = true;
    let next;
    let END = {
        DR: 'IDLE',
        IR: 'IDLE'
    };
    let extra = {
        H: {
            DR: {len: 0, dat: '00'},
            IR: {len: 0, dat: '00'}
        },
        T: {
            DR: {len: 0, dat: '00'},
            IR: {len: 0, dat: '00'}
        }
    };
    let _R = '';
    let bitLen = 0;
    let tmp = '';
    let freq = 500e3;
    let oldState = 'any';

    const HTIDR = (key1, key2) =>
        async m => {
            const len = parseInt(m[1], 10) || 0;
            let dat = m[2] || '00';
            if (dat.length & 0x1) {
                dat = '0' + dat;
            }
            extra[key1][key2] = {len: len, dat: dat};
            state = 'space';
        };

    const on = {
        default: async () => { state = 'space'; },
        space:  async m => { state = m[1]; console.log("\x1b[32m", state);},
        ENDDR:  async m => { END.DR = m[1]; state = 'spacelog'; console.log("\x1b[32m", m[1]); },
        ENDIR:  async m => { END.IR = m[1]; state = 'space'; },
        HDR:    HTIDR('H', 'DR'),
        HIR:    HTIDR('H', 'IR'),
        TDR:    HTIDR('T', 'DR'),
        TIR:    HTIDR('T', 'IR'),
        FREQUENCY: async m => {
             freq = Number(m[1]);
             state = 'space';
        },
        STATE: async m => {
            state = 'space';
            const newState = m[1];
            await jtag.TMS(oldState, newState);
            oldState = newState;
        },
        RUNTEST: async m => {
            console.log("::DAD");
            state = 'space';
            const time = Number(m[4]);
            const bits = time * freq;
            const newState = m[1];
            await jtag.TMS(oldState, newState);
            oldState = newState;
            await jtag.TCK(bits);
            // await sleep(t * 1000);
        },
        SIR: async m => {
            state = 'TDI';
            _R = 'IR';
            tmp = '';
            bitLen = parseInt(m[1], 16);
            await jtag.TMS(oldState, END.IR);
            const newState = 'IRSHIFT';
            await jtag.TMS(END.IR, newState);
            oldState = newState;
        },
        SDR: async m => {
            state = 'TDI';
            _R = 'DR';
            tmp = '';
            bitLen = parseInt(m[1], 16);
            //console.log(bitLen);
            await jtag.TMS(oldState, END.DR);
            const newState = 'DRSHIFT';
            await jtag.TMS(END.DR, newState);
            oldState = newState;
        },
        TDI: async m => {
            const part = m[1];
            if (part !== undefined) {
                tmp += part;
            } else {
                const io = (m[2] !== undefined) ? false : true;
                // TODO check (m[3] !== undefined)

                const head = extra.H[_R];
                const tail = extra.T[_R];
                await jtag.TDI(head.dat, head.len, io, 0);
                await jtag.TDI(tmp, bitLen, io, ((tail.len > 0) ? 0 : 1));
                await jtag.TDI(tail.dat, tail.len, io, 1);
                tmp = '';
                const newState = END[_R];
                await jtag.TMS(_R + 'PAUSE', newState);
                oldState = newState;
                state = 'space';
            }
        }
    };

    function handle_instruction (vector) {
        /** switch (vector[0]) {
            case 'FREQUENCY':
                freq = parseFloat(vector[1]);
                break;
            case 'ENDDR':
                END.DR =
        } **/


    };

    const parse = () => {
        console.log("Parsing Now : " + tail);

        if (tail.charAt(0) === '!')
            // Comment
            return;

        const lastChar = tail.slice(-1);

        if (lastChar === '\r' || lastChar === ';')
            tail = tail.slice(0, -1);
            // Remove last character

        let isComplete = false;
        if (lastChar === ';')
            isComplete = true;
            // A statement may not complete in a line

        let vector = tail.split(" ");

        if (isComplete) {

        }


        //console.log(rules[state]);

        /** const pattern = rules[state] || rules.default;
        const m = tail.match(pattern);

        if (m === null) {
            next();
            return;
        }
        const i = m.index;
        let body = m[0]; //.input.split('\n')[0];
        console.log('\x1b[31m', state);
        console.log('\x1b[36m%s\x1b[0m',body);

        tail = m.input.slice(i + body.length);
        state =body.trim();

        //console.log(tail.split('\n')[0]);
        //console.log("--------\n");
        (on[state] || on.default)(m).then(parse).catch(err => {
            console.log(err);
        }); **/
    };

    return (chunk, env, _next) => {
        tail += chunk; // <<-- check
        //console.log(chunk);
        next = _next;
        if (firstChunk) {
            firstChunk = false;
            jtag.open().then(parse);
            return;
        }
        parse();
    };
};
