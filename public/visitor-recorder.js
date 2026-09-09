/* global AudioWorkletProcessor, registerProcessor */
// The microphone stays on the device until the visitor sends this bounded turn.
class VisitorRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      const copy = channel.slice();
      this.port.postMessage(copy.buffer, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor('visitor-recorder', VisitorRecorder);
