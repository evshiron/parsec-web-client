// WASM
// import {importMetaURL} from './wasm/import-meta.js';
import opusModule from './wasm/opus.js';
import opusWasm from './wasm/opus.wasm';

const FRAMES = 960; //the Parsec server will always output 20ms packets at 48khz
const QUEUED_PACKETS = 2;
const OUTPUT_SIZE = FRAMES * QUEUED_PACKETS;

export class AudioPlayer {
	constructor() {
		this.ctx = new (window.AudioContext || window.webkitAudioContext)();
		this.nextTime = this.ctx.currentTime;
		this.offset = 0;
		this.bufSource = null;
		this.left = null;
		this.right = null;
		this.encodeU8 = null;
		this.decodeF32 = null;
		this.opus = null;
		this.ready = false;

		this._refreshBuffer();

		this.opus = opusModule({
			onRuntimeInitialized: () => {
				this.opus.ccall('init', 'number');

				const encodePtr = this.opus.ccall('encode_buf', 'number');
				const decodePtr = this.opus.ccall('decode_buf', 'number');
				this.encodeU8 = new Uint8Array(this.opus.HEAPU8.buffer, encodePtr);
				this.decodeF32 = new Float32Array(this.opus.HEAPF32.buffer, decodePtr);

				this.ready = true;
			},

			// edit: previously import.meta is used to locate the .wasm,
			// here we use the webpack way to include a specified file in the build
			locateFile: () => opusWasm,
		});
	}

	_refreshBuffer() {
		const buf = this.ctx.createBuffer(2, OUTPUT_SIZE, 48000);
		this.left = buf.getChannelData(0);
		this.right = buf.getChannelData(1);
		this.bufSource = this.ctx.createBufferSource();
		this.bufSource.buffer = buf;
		this.bufSource.connect(this.ctx.destination);
		this.offset = 0;
	}

	queueData(packet) {
		//drop any incoming data until WASM is ready -- opus has no problem recovering
		if (!this.ready) return;

		//drop packets if too much audio is queued
		if (this.nextTime - this.ctx.currentTime > 0.200) return;

		//fill the input buffer to the Opus decoder with raw opus packets
		this.encodeU8.set(new Uint8Array(packet));

		//decoded PCM data (2 channel, 32-bit float, 48Khz)
		const frames = this.opus.ccall('decode', 'number', ['number'], [packet.byteLength]);

		for (let x = 0; x < frames * 2; x += 2) {
			this.left[this.offset] = this.decodeF32[x];
			this.right[this.offset] = this.decodeF32[x + 1];
			this.offset++;
		}

		if (this.offset === OUTPUT_SIZE) {
			if (this.nextTime < this.ctx.currentTime)
				this.nextTime = this.ctx.currentTime + 0.070;

			this.bufSource.start(this.nextTime);
			this.nextTime += this.bufSource.buffer.duration;

			this._refreshBuffer();
		}
	}

	destroy() {
		this.opus.ccall('cleanup');
	}
}
