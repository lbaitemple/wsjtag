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
    let newState = 'any';
    let svf_XYR = {
        len: 0, tdo: '', tdi: '', mask: '', smask: ''
    }

    function clear_svf_XYR ()    {
        svf_XYR.len = 0;
        svf_XYR.tdo = '';
        svf_XYR.tdi = '';
        svf_XYR.mask = '';
        svf_XYR.smask = '';
    }

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

    async function parse_XYR (vector)   {
        svf_XYR.len = parseInt(vector[1]);
        if (svf_XYR.len === 0) {
            clear_svf_XYR;
            return;
        }

        let mode = 0;
        let write_data = vector[0][1] == 'I' ? 0 : 1;
        let full_line = "";

        for (let pos=2; pos < vector.size(); pos++) {
            let s = vector[pos];
            switch (s)  {
                case 'TDO':
                    mode = 1;
                    continue;
                case 'TDI':
                    mode = 2;
                    continue;
                case 'MASK':
                    mode = 3;
                    continue;
                case 'SMASK':
                    mode = 4;
                    continue;
                default:
                    break;
            }
            if (s.charAt(0)  == '(' || s.charAt(0)  == '\t')
                s = s.substr(1);
            if (s.charAt(s.length - 1) == ')')
                s = s.slice(0, s.length - 1);
            full_line += s;
            s = "";

            if (s.charAt(s.length - 1) == ')') {
                switch (mode) {
                    case 1:
                        svf_XYR.tdo = full_line;
                        break;
                    case 2:
                        svf_XYR.tdi = full_line;
                        break;
                    case 3:
                        svf_XYR.mask = full_line;
                        break;
                    case 4:
                        svf_XYR.smask = full_line;
                        break;
                    default:
                        break;
                }
                full_line = "";
            }
        }

        let c = ' ';
        let len = svf_XYR.tdi.size() / 2 + ((svf_XYR.tdi.size() % 2)? 1 : 0);
        let txbuf = ''.padStart(len);

        for (let i = svf_XYR.tdi.length-1, pos = 0; i >= 0; i--, pos++) {
            if (svf_XYR.tdi.charAt(i) <= '9')
                c = 0x0f & (svf_XYR.tdi[i] - '0');
            else
                c = 0x0f & (svf_XYR.tdi[i] - 'A' + 10);

            txbuf[pos/2] |= ((0x0F & c) << ((4*(pos & 1))));
        }


    }

    async function handle_instruction (vector) {
        switch (vector[0]) {
            case 'FREQUENCY':
                freq = parseFloat(vector[1]);
                state = 'space';
                break;
            case 'ENDDR':
                END.DR = vector[1];
                state = 'spacelog';
                break;
            case 'ENDIR':
                END.IR = vector[1];
                state = 'space';
                break;
            case 'STATE':
                newState = vector[1];
                await jtag.TMS(oldState, newState);
                oldState = newState;
                break;
            case 'RUNTEST':
                const time = Number(vector[4]);
                const bits = time * freq;
                newState = vector[1];
                await jtag.TMS(oldState, newState);
                oldState = newState;
                await jtag.TCK(bits);
                break;
            case 'HIR':
                HTIDR('H', 'IR');
                break;
            case 'HDR':
                HTIDR('H', 'DR');
                break;
            case 'TIR':
                HTIDR('T', 'IR');
                break;
            case 'TDR':
                HTIDR('T', 'DR');
                break;
            case 'SIR':
                parse_XYR (vector);
                break;
            case 'SDR':
                parse_XYR (vector);
                break;
            default:
                console.log("Unknown instruction " + vector[0]);
                break;
        }


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
