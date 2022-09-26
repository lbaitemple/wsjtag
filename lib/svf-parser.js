'use strict';

const rules = require('./svf-rules');

module.exports = jtag => {
    let tail = '';
    let state = 'space';
    let firstChunk = true;
    let next;
    let END = {
        DR: 1,
        IR: 1
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
    let tapState_t = {
        TEST_LOGIC_RESET: 0,
        RUN_TEST_IDLE: 1,
        SELECT_DR_SCAN: 2,
        CAPTURE_DR: 3,
        SHIFT_DR: 4,
        EXIT1_DR: 5,
        PAUSE_DR: 6,
        EXIT2_DR: 7,
        UPDATE_DR: 8,
        SELECT_IR_SCAN: 9,
        CAPTURE_IR: 10,
        SHIFT_IR: 11,
        EXIT1_IR: 12,
        PAUSE_IR: 13,
        EXIT2_IR: 14,
        UPDATE_IR: 15,
        UNKNOWN: 999
    };
    let _state = tapState_t.TEST_LOGIC_RESET;
    let fsm_state = {
        "RESET": 0,
        "IDLE": 1,
        "DRSELECT": 2,
        "DRCAPTURE": 3,
        "DRSHIFT": 4,
        "DREXIT1": 5,
        "DRPAUSE": 6,
        "DREXIT2": 7,
        "DRUPDATE": 8,
        "IRSELECT": 9,
        "IRCAPTURE": 10,
        "IRSHIFT": 11,
        "IREXIT1": 12,
        "IRPAUSE": 13,
        "IREXIT2": 14,
        "IRUPDATE": 15
    };
    let _R = '';
    let bitLen = 0;
    let tmp = '';
    let freq = 500e3;
    let oldState = 'any';
    let newState = 'any';
    function svf_XYR() {
        this.len = 0
        this.tdo = ''
        this.tdi = ''
        this.mask = ''
        this.smask = ''
    };
    let hdr = new svf_XYR();
    let hir = new svf_XYR();
    let sdr = new svf_XYR();
    let sir = new svf_XYR();
    let tdr = new svf_XYR();
    let tir = new svf_XYR();
    let _num_tms = 0;
    let _tms_buffer = [];
    let _run_state = fsm_state.IDLE;
    let _end_state = fsm_state.IDLE;
    let _in_buf = '';
    let _nb_bit = 0;
    let _buffer_size = 64; // TODO Need to check exact value

    let _tck_pin = (1 << 0);
    let _tms_pin = (1 << 1);
    let _tdi_pin = (1 << 4);

    function setTMS(tms) {
        if (_num_tms+1 == _tms_buffer.length * 8)
            if (_num_tms != 0)  {
                flushTMS(false);
            }
        if (tms != 0)
            _tms_buffer[_num_tms>>3] |= (0x1) << (_num_tms & 0x7);
        _num_tms++;
    }

    function writeTMS(tms, len, flush_buffer) {
        let ret;

        /* nothing to send
         * but maybe need to flush internal buffer
         */
        if (len == 0) {
            if (flush_buffer) {
                ret = flush();
                return ret;
            }
            return 0;
        }

        /* check for at least one bit space in buffer */
        if (_nb_bit+2 > _buffer_size) {
            ret = flush();
            if (ret < 0)
                return ret;
        }

        let _curr_tms;

        /* fill buffer to reduce USB transaction */
        for (let i = 0; i < len; i++) {
            _curr_tms = ((tms[i >> 3] & (1 << (i & 0x07)))? _tms_pin : 0);
            let val = ((1 << 2) | (1 << 3) | (1 << 5)) | (0 << 6) | (0 << 7) | _tdi_pin | _curr_tms;
            // DEFAULT | DO_WRITE | DO_BITBB

            _in_buf[_nb_bit++] = val;
            _in_buf[_nb_bit++] = val | _tck_pin;

            if (_nb_bit + 2 > _buffer_size) {
                ret = flush();
                if (ret < 0)
                    return ret;
            }
        }
        _in_buf[_nb_bit++] = ((1 << 2) | (1 << 3) | (1 << 5)) | (0 << 6) | (0 << 7) | _curr_tms;

        /* security check: try to flush buffer */
        if (flush_buffer) {
            ret = flush();
            if (ret < 0)
                return ret;
        }
        //printInfo("writeTMS: end");

        return len;
    }

    function flushTMS(flush_buffer) {
        let ret = 0;
        if (_num_tms != 0) {
            ret = writeTMS(_tms_buffer, _num_tms, flush_buffer);

            /* reset buffer and number of bits */
            _tms_buffer = [];
            _num_tms = 0;
        } else if (flush_buffer) {
            flush();
        }
        return ret;
    }

    function write(read, rd_len) {
        let ret = 0;
        if (_nb_bit == 0)
            return 0;

        ret = 0; // TODO ftdi_write_data(_ftdi, _in_buf, _nb_bit);
        if (ret != _nb_bit) {
            console.log("problem %d written %d\n", ret, _nb_bit);
            return ret;
        }

        if (read) {
            let timeout = 100;
            let byte_read = 0;
            while (byte_read < rd_len && timeout != 0) {
                timeout--;
                ret = 0; // TODO ftdi_read_data(_ftdi, _in_buf + byte_read, rd_len - byte_read);
                if (ret < 0)
                    return ret;
                byte_read += ret;
            }

            if (timeout == 0)
                return 0;
        }
        _nb_bit = 0;
        return ret;
    }

    function flush() {
        return write(false, 0);
    }

    function set_state (newState) {
        let tms = 0;
        while (newState != _state) {
            switch (_state) {
                case tapState_t.TEST_LOGIC_RESET:
                    if (newState == tapState_t.TEST_LOGIC_RESET) {
                        tms = 1;
                    } else {
                        tms = 0;
                        _state = tapState_t.RUN_TEST_IDLE;
                    }
                    break;
                case tapState_t.RUN_TEST_IDLE:
                    if (newState == tapState_t.RUN_TEST_IDLE) {
                        tms = 0;
                    } else {
                        tms = 1;
                        _state = tapState_t.SELECT_DR_SCAN;
                    }
                    break;
                case tapState_t.SELECT_DR_SCAN:
                    switch (newState) {
                        case tapState_t.CAPTURE_DR:
                        case tapState_t.SHIFT_DR:
                        case tapState_t.EXIT1_DR:
                        case tapState_t.PAUSE_DR:
                        case tapState_t.EXIT2_DR:
                        case tapState_t.UPDATE_DR:
                            tms = 0;
                            _state = tapState_t.CAPTURE_DR;
                            break;
                        default:
                            tms = 1;
                            _state = tapState_t.SELECT_IR_SCAN;
                    }
                    break;
                case tapState_t.SELECT_IR_SCAN:
                    switch (newState) {
                        case tapState_t.CAPTURE_IR:
                        case tapState_t.SHIFT_IR:
                        case tapState_t.EXIT1_IR:
                        case tapState_t.PAUSE_IR:
                        case tapState_t.EXIT2_IR:
                        case tapState_t.UPDATE_IR:
                            tms = 0;
                            _state = tapState_t.CAPTURE_IR;
                            break;
                        default:
                            tms = 1;
                            _state = tapState_t.TEST_LOGIC_RESET;
                    }
                    break;
                case tapState_t.CAPTURE_DR:
                    if (newState == tapState_t.SHIFT_DR) {
                        tms = 0;
                        _state = tapState_t.SHIFT_DR;
                    } else {
                        tms = 1;
                        _state = tapState_t.EXIT1_DR;
                    }
                    break;
                case tapState_t.SHIFT_DR:
                    if (newState == tapState_t.SHIFT_DR) {
                        tms = 0;
                    } else {
                        tms = 1;
                        _state = tapState_t.EXIT1_DR;
                    }
                    break;
                case tapState_t.EXIT1_DR:
                    switch (newState) {
                        case tapState_t.PAUSE_DR:
                        case tapState_t.EXIT2_DR:
                        case tapState_t.SHIFT_DR:
                        case tapState_t.EXIT1_DR:
                            tms = 0;
                            _state = tapState_t.PAUSE_DR;
                            break;
                        default:
                            tms = 1;
                            _state = tapState_t.UPDATE_DR;
                    }
                    break;
                case tapState_t.PAUSE_DR:
                    if (newState == tapState_t.PAUSE_DR) {
                        tms = 0;
                    } else {
                        tms = 1;
                        _state = tapState_t.EXIT2_DR;
                    }
                    break;
                case tapState_t.EXIT2_DR:
                    switch (newState) {
                        case tapState_t.SHIFT_DR:
                        case tapState_t.EXIT1_DR:
                        case tapState_t.PAUSE_DR:
                            tms = 0;
                            _state = tapState_t.SHIFT_DR;
                            break;
                        default:
                            tms = 1;
                            _state = tapState_t.UPDATE_DR;
                    }
                    break;
                case tapState_t.UPDATE_DR:
                    if (newState == tapState_t.RUN_TEST_IDLE) {
                        tms = 0;
                        _state = tapState_t.RUN_TEST_IDLE;
                    } else {
                        tms = 1;
                        _state = tapState_t.SELECT_DR_SCAN;
                    }
                    break;
                /* IR column */
                case tapState_t.CAPTURE_IR:
                    if (newState == tapState_t.SHIFT_IR) {
                        tms = 0;
                        _state = tapState_t.SHIFT_IR;
                    } else {
                        tms = 1;
                        _state = tapState_t.EXIT1_IR;
                    }
                    break;
                case tapState_t.SHIFT_IR:
                    if (newState == tapState_t.SHIFT_IR) {
                        tms = 0;
                    } else {
                        tms = 1;
                        _state = tapState_t.EXIT1_IR;
                    }
                    break;
                case tapState_t.EXIT1_IR:
                    switch (newState) {
                        case tapState_t.PAUSE_IR:
                        case tapState_t.EXIT2_IR:
                        case tapState_t.SHIFT_IR:
                        case tapState_t.EXIT1_IR:
                            tms = 0;
                            _state = tapState_t.PAUSE_IR;
                            break;
                        default:
                            tms = 1;
                            _state = tapState_t.UPDATE_IR;
                    }
                    break;
                case tapState_t.PAUSE_IR:
                    if (newState == tapState_t.PAUSE_IR) {
                        tms = 0;
                    } else {
                        tms = 1;
                        _state = tapState_t.EXIT2_IR;
                    }
                    break;
                case tapState_t.EXIT2_IR:
                    switch (newState) {
                        case tapState_t.SHIFT_IR:
                        case tapState_t.EXIT1_IR:
                        case tapState_t.PAUSE_IR:
                            tms = 0;
                            _state = tapState_t.SHIFT_IR;
                            break;
                        default:
                            tms = 1;
                            _state = tapState_t.UPDATE_IR;
                    }
                    break;
                case tapState_t.UPDATE_IR:
                    if (newState == tapState_t.RUN_TEST_IDLE) {
                        tms = 0;
                        _state = tapState_t.RUN_TEST_IDLE;
                    } else {
                        tms = 1;
                        _state = tapState_t.SELECT_DR_SCAN;
                    }
                    break;
            }
            setTMS(tms);
        }
        flushTMS(false);
    }

    function toggleClk(tms, tdi, clk_len) {
        let xfer_len = clk_len;
        let mask = (1 << 7) | (0 << 6); // DO_SHIFT | DO_WRITE

        if (tms == 0 && xfer_len >= 8) {
            _in_buf[_nb_bit++] = ((1<<2) | (1<<3) | (1 << 5)) | (0 << 6) | (0 << 7);
            // DEFAULT | DO_WRITE | DO_BITBB
            flush();
            /* fill a byte with all 1 or all 0 */
            let content = (tdi)?0xff:0;

            while (xfer_len >= 8) {
                let tx_len = (xfer_len >> 3);
                if (tx_len > 63)
                    tx_len = 63;
                /* if not enough space flush */
                if (_nb_bit + tx_len + 1 > 64)
                    if (flush() < 0)
                        return -1;
                _in_buf[_nb_bit++] = mask | tx_len;
                for (let i = 0; i < tx_len; i++)
                    _in_buf[_nb_bit++] = content;
                xfer_len -= (tx_len << 3);
            }
        }

        mask = (1<<2) | (1 << 5) | (1<<3) | ((tms) ? _tms_pin : 0) | ((tdi) ? _tdi_pin : 0)
        //DEFAULT | DO_BITBB | DO_WRITE | ((tms) ? _tms_pin : 0) | ((tdi) ? _tdi_pin : 0);
        while (xfer_len > 0) {
            if (_nb_bit + 2 > _buffer_size)
                if (flush() < 0)
                    return -EXIT_FAILURE;
            _in_buf[_nb_bit++] = mask;
            _in_buf[_nb_bit++] = mask | _tck_pin;

            xfer_len--;
        }

        /* flush */
        _in_buf[_nb_bit++] = mask;
        flush();

        return clk_len;
    }

    function toggleClk(nb)  {
        let c = (fsm_state.TEST_LOGIC_RESET == _state) ? 1 : 0;
        flushTMS(false);
        if (toggleClk(c, 0, nb) < 0)
            throw "ERROR";
        return;
    }

    function parse_runtest (vector)  {
        let pos = 1;
        let nb_iter = 0;
        let run_state = -1;
        let end_state = -1;

        if (vector[pos][0] > '9') {
            run_state = fsm_state[vector[1]];
            pos++;
        }
        nb_iter = parseInt(vector);
        pos++;
        pos++; // clk currently don't care
        if (vector[pos].equals("ENDSTATE")) {
            pos++;
            end_state = fsm_state[vector[pos]];
        }

        if (run_state != -1) {
            _run_state = run_state;
        }
        if (end_state != -1) {
            _end_state = end_state;
        }
        else if (run_state != -1)
            _end_state = run_state;
        set_state(_run_state);
        toggleClk(nb_iter);
        set_state(_end_state);
    }

    function clear_svf_XYR (a)   {
        a.len = 0;
        a.tdo = '';
        a.tdi = '';
        a.mask = '';
        a.smask = '';
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

    function parse_XYR (vector, xyr)   {
        xyr.len = parseInt(vector[1]);
        if (xyr.len === 0) {
            clear_svf_XYR(xyr);
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
                        xyr.tdo = full_line;
                        break;
                    case 2:
                        xyr.tdi = full_line;
                        break;
                    case 3:
                        xyr.mask = full_line;
                        break;
                    case 4:
                        xyr.smask = full_line;
                        break;
                    default:
                        break;
                }
                full_line = "";
            }
        }

        let c = ' ';
        let len = xyr.tdi.size() / 2 + ((xyr.tdi.size() % 2)? 1 : 0);
        let txbuf = ''.padStart(len);

        for (let i = xyr.tdi.length-1, pos = 0; i >= 0; i--, pos++) {
            if (xyr.tdi.charAt(i) <= '9')
                c = 0x0f & (xyr.tdi[i] - '0');
            else
                c = 0x0f & (xyr.tdi[i] - 'A' + 10);

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
                END.DR = fsm_state[vector[1]];
                state = 'spacelog';
                break;
            case 'ENDIR':
                END.IR = fsm_state[vector[1]];
                state = 'space';
                break;
            case 'STATE':
                newState = fsm_state[vector[1]];
                set_state(newState);
                break;
            case 'RUNTEST':
                parse_runtest(vector);
                break;
            case 'HIR':
                parse_XYR(vector, hir);
                break;
            case 'HDR':
                parse_XYR(vector, hdr);
                break;
            case 'TIR':
                parse_XYR(vector, tir);
                break;
            case 'TDR':
                parse_XYR(vector, tdr);
                break;
            case 'SIR':
                parse_XYR(vector, sir);
                break;
            case 'SDR':
                parse_XYR(vector, sdr);
                break;
            default:
                console.log("Unknown instruction " + vector[0]);
                break;
        }
    };


    function parse_line (line) {
        if (line.charAt(0) === '!')
            // Comment
            return;

        const lastChar = line.slice(-1);

        let isComplete = false;
        tail += " " + line;

        if (lastChar === ";")
            isComplete = true;

        // A statement may not complete in a line

        let vector = [];

        if (isComplete) {
            tail = tail.slice(0, -1);
            // remove last character ;
            vector.push(tail.split(" "));
            tail = '';
        }

         const pattern = rules[state] || rules.default;

         /**const m = tail.match(pattern);

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

    function parse (indata) {
        let lines = indata
            .replace('\r', '')
            .replace(/\t/g, '')
            .split('\n');
        for (const line of lines)
            parse_line(line);
    }

    return (chunk, env, _next) => {
        next = _next;
        setTimeout(_next, 500);
        if (firstChunk) {
            firstChunk = false;
            jtag.open().then(function() {}).catch((e) => {});
            parse(chunk.toString());
        }
        parse(chunk.toString());
    };
};