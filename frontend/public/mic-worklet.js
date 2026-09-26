// Runs on the browser's audio thread. It does one job: hand each small block
// of microphone samples to the main page, where lib/segmenter.ts decides what
// to do. This file is loaded directly by the browser (audioContext.audioWorklet
// .addModule('/mic-worklet.js')), not bundled by Next -- that's why it's here
// in public/ as plain JS instead of under src/.
class MicTap extends AudioWorkletProcessor {
  process(inputs) {
    const samples = inputs[0][0];
    // slice() copies, because the browser reuses the same buffer next time.
    if (samples) this.port.postMessage(samples.slice());
    return true; // keep running
  }
}
registerProcessor('mic-tap', MicTap);
