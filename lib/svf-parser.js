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
    let BIT_CONST = {
        DO_READ: (1<<6),
        DO_WRITE: (0<<6),
        DO_RDWR: (1<<6),
        DO_SHIFT: (1<<7),
        DO_BITBB: (0<<7),
        DEFAULT: ((1<<2) | (1<<3) | (1<<5))
    }

    function svf_XYR() {
        this.len = 0;
        this.tdo = '';
        this.tdi = '';
        this.mask = '';
        this.smask = '';
    };
    let hdr = new svf_XYR();
    let hir = new svf_XYR();
    let sdr = new svf_XYR();
    let sir = new svf_XYR();
    let tdr = new svf_XYR();
    let tir = new svf_XYR();
    let _num_tms = 0;
    let _tms_buffer = new Uint8Array(128);
    let _run_state = fsm_state.IDLE;
    let _end_state = fsm_state.IDLE;
    let _nb_bit = 0;
    let _buffer_size = 64;
    let _in_buf = new Uint8Array(_buffer_size);

    let _tck_pin = (1 << 0);
    let _tms_pin = (1 << 1);
    let _tdi_pin = (1 << 4);
    let _curr_tms = 0;

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

        /* fill buffer to reduce USB transaction */
        for (let i = 0; i < len; i++) {
            _curr_tms = ((tms[i >> 3] & (1 << (i & 0x07)))? _tms_pin : 0);
            let val = BIT_CONST.DEFAULT | BIT_CONST.DO_WRITE | BIT_CONST.DO_BITBB | _tdi_pin | _curr_tms;

            _in_buf[_nb_bit++] = val;
            _in_buf[_nb_bit++] = val | _tck_pin;

            if (_nb_bit + 2 > _buffer_size) {
                ret = flush();
                if (ret < 0)
                    return ret;
            }
        }
        _in_buf[_nb_bit++] = BIT_CONST.DEFAULT | BIT_CONST.DO_WRITE | BIT_CONST.DO_BITBB | _curr_tms;

        /* security check: try to flush buffer */
        if (flush_buffer) {
            ret = flush();
            if (ret < 0)
                return ret;
        }

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

        console.log("Buffer bits written = " + _nb_bit);

        ret = 0; // TODO : ftdi_write_data(_ftdi, _in_buf, _nb_bit);
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

            if (timeout == 0) {
                console.log("Error: timeout " + byte_read)
                return 0;
            }
        }
        _nb_bit = 0;
        return ret;
    }

    function read_write(tdi, tdo, len, last) {
        flushTMS(false);
        writeTDI(tdi, tdo, len, last);
        if (last == 1)
            _state = (_state == tapState_t.SHIFT_DR) ? tapState_t.EXIT1_DR : tapState_t.EXIT1_IR;
        return 0;
    }

    function writeTDI (tx, rx, len, last) {
        let real_len = (last == 1) ? len - 1 : len;
        let nb_byte = real_len >> 3;
        let nb_bit = real_len && 0x07;
        let mode = (rx != null) ? BIT_CONST.DO_RDWR : BIT_CONST.DO_WRITE;

        let tx_ptr = 0;
        let rx_ptr = 0;

        _in_buf[_nb_bit++] = BIT_CONST.DEFAULT | BIT_CONST.DO_BITBB | BIT_CONST.DO_WRITE | _curr_tms;
        flush();

        if (_curr_tms == 0 && nb_byte != 0) {
            let mask = BIT_CONST.DO_SHIFT | mode;

            while (nb_byte != 0) {
                let tx_len = nb_byte;
                if (tx_len > 63)
                    tx_len = 63;
                /* if not enough space flush */
                if (_nb_bit + tx_len + 1 > 64) {
                    let num_read = _nb_bit -1;
                    if (writeByte((rx != null)?rx_ptr:null, num_read) < 0)  // TODO : Implement writeByte
                        return -1;
                    if (rx != null)
                        rx_ptr += num_read;
                }
                _in_buf[_nb_bit++] = mask | (tx_len & 0x3f);
                if (tx != null) {
                    // TODO: memcpy(&_in_buf[_nb_bit], tx_ptr, tx_len);
                    tx_ptr += tx_len;
                } else {
                    // TODO: memset(&_in_buf[_nb_bit], 0, tx_len);
                }
                _nb_bit += tx_len;
                nb_byte -= tx_len;
            }

            if (_nb_bit != 0) {
                let num_read = _nb_bit-1;
                if (writeByte((rx!=null)?rx_ptr:null, num_read) < 0) // TODO : Implement writeByte
                    return -1;
                if (rx != null)
                    rx_ptr += num_read;
            }
        }

        if (nb_bit != 0) {
            let mask = BIT_CONST.DEFAULT | BIT_CONST.DO_BITBB;
            if (_nb_bit + 2 > _buffer_size) {
                let num_read = _nb_bit;
                if (writeBit((rx!=null)? rx_ptr:null, Math.floor(num_read/2)) < 0)
                    // TODO : Implement writeBit
                    return -1;
                if (rx != null)
                    rx_ptr += num_read;
            }
            for (let i = 0; i < nb_bit; i++) {
                let val = 0;
                if (tx != null)
                    val = val | ((tx_ptr[i >> 3] & (1 << (i & 0x07)))? _tdi_pin : 0);
                _in_buf[_nb_bit++] = mask | val;
                _in_buf[_nb_bit++] = mask | mode | val | _tck_pin;
            }

            let num_read = _nb_bit;
            if (writeBit((rx!=null)? rx_ptr:null, Math.floor(num_read/2)) < 0)
                // TODO : Implement writeBit
                return -1;
        }

        /* set TMS high */
        if (last) {
            //printf("end\n");
            _curr_tms = _tms_pin;
            let mask = BIT_CONST.DEFAULT | BIT_CONST.DO_BITBB | _curr_tms;
            if (tx != null & (1 << nb_bit))
                mask = mask | _tdi_pin;
            _in_buf[_nb_bit++] = mask;
            _in_buf[_nb_bit++] = mask | mode | _tck_pin;
            let tmp = 0;
            if (writeBit((rx!=null)?tmp:null, 1) < 0)
                // TODO : Implement writeBit
            return -1;
            if (rx != null)
                rx_ptr = (tmp & 0x80) | ((rx_ptr) >> 1);
            _in_buf[_nb_bit++] = mask;
            if (writeBit(null, 0) < 0)
                // TODO : Implement writeBit
                return -1;
        }
    return len;
    }

    function flush() {
        //return write(false, 0);
        return 0; // TODO: Remove this
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
                    /* DR column */
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
        let mask = BIT_CONST.DO_SHIFT | BIT_CONST.DO_WRITE;

        if (tms == 0 && xfer_len >= 8) {
            _in_buf[_nb_bit++] = BIT_CONST.DEFAULT | BIT_CONST.DO_WRITE | BIT_CONST.DO_BITBB;
            let v1 = flush();
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

        mask = BIT_CONST.DEFAULT | BIT_CONST.DO_BITBB | BIT_CONST.DO_WRITE | ((tms) ? _tms_pin : 0) | ((tdi) ? _tdi_pin : 0);
        while (xfer_len > 0) {
            if (_nb_bit + 2 > _buffer_size)
                if (flush() < 0)
                    return -1;
            _in_buf[_nb_bit++] = mask;
            _in_buf[_nb_bit++] = mask | _tck_pin;

            xfer_len--;
        }

        /* flush */
        _in_buf[_nb_bit++] = mask;
        let v2 = flush();

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
        nb_iter = parseInt(vector[pos]);
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
        let mode = 0;
        let full_line = "".padStart(1276);
        let write_data = vector[0][0] == 'S' ? (vector[0][1] == 'I' ? 0 : 1) : -1;

        xyr.len = parseInt(vector[1]);
        if (xyr.len === 0) {
            clear_svf_XYR(xyr);
            return;
        }

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
                s = s.substring(1);
            if (s.charAt(s.length - 1) == ')')
                s = s.slice(0, s.length - 1);
            full_line += s;

            if (vector[pos].slice(-1) == ')') {
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

        if (write_data != -1)   {
            let len = Math.floor(xyr.tdi.length / 2) + ((xyr.tdi.length % 2)? 1 : 0);
            let txbuf = new Uint8Array(len);
            let c = 0;

            for (let i = xyr.tdi.length-1, pos = 0; i >= 0; i--, pos++) {
                if (xyr.tdi.charAt(i) <= '9')
                    c = 0x0f & (xyr.tdi[i] - '0');
                else
                    c = 0x0f & (xyr.tdi[i] - 'A' + 10);

                txbuf[Math.floor(pos / 2)] |= ((0x0F & c) << ((4 * (pos & 1))));
            }

            if (write_data == 0)
                shiftIR(txbuf, null, xyr.len, END.IR);
            else
                shiftDR(txbuf, null, xyr.len, END.DR);
        }
    }

    function shiftIR(tdi, tdo, irlen, end_state)  {
        set_state(tapState_t.SHIFT_IR);
        flushTMS(false);
        read_write(tdi, tdo, irlen, 1); // 1 since only one device
        set_state(end_state);
        return 0;
    }

    function shiftDR(tdi, tdo, drlen, end_state)  {
        set_state(tapState_t.SHIFT_DR);
        flushTMS(false);
        read_write(tdi, tdo, drlen, 1); // 1 since only one device
        set_state(end_state);
        return 0;
    }

    function handle_instruction (vector) {
        switch (vector[0]) {
            case 'FREQUENCY':
                freq = parseFloat(vector[1]);
                state = 'space';
                console.log("frequency value = " + vector[1] + " unit " + vector[2]);
                break;
            case 'TRST':
                console.log("trst value = " + vector[1]);
                break;
            case 'ENDDR':
                END.DR = fsm_state[vector[1]];
                console.log("enddr value = " + vector[1]);
                state = 'spacelog';
                break;
            case 'ENDIR':
                END.IR = fsm_state[vector[1]];
                console.log("endir value = " + vector[1]);
                state = 'space';
                break;
            case 'STATE':
                newState = fsm_state[vector[1]];
                console.log("state value = " + vector[1]);
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

    function parse_line (line_raw) {
        let line = line_raw.toString().replace(/\r\n/g,'\n')
            // remove \r

        if (line.charAt(0) === '!')
            // Comment
            return;

        let isComplete = false;
        let lastChar = line.slice(-1);

        if (lastChar === ";") {
            isComplete = true;
            line = line.slice(0, -1);
        }

        tail += " " + line;

        // A statement may not complete in a line

        let vector = [];

        if (isComplete) {
            vector.push(tail.split(" "));

            const pattern = rules[state] || rules.default;
            const m = tail.match(pattern);

            handle_instruction(vector);
            tail = '';
        }
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