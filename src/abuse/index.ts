import { EventEmitter } from 'events';

export { SpikeDetector } from './spikeDetector';
export type { SpikeEvent, SpikeDetectorOptions } from './spikeDetector';

export { CredentialStuffingDetector } from './credentialStuffingDetector';
export type {
  CredentialStuffingEvent,
  CredentialStuffingDetectorOptions,
} from './credentialStuffingDetector';

export type { AbuseDetector } from './types';

import { SpikeDetector } from './spikeDetector';
import type { SpikeEvent } from './spikeDetector';
import { CredentialStuffingDetector } from './credentialStuffingDetector';
import type { CredentialStuffingEvent } from './credentialStuffingDetector';
import type { AbuseDetector } from './types';

export interface AbuseDetectors {
  detectors: AbuseDetector[];
  emitter: EventEmitter;
}

export function createAbuseDetectors(): AbuseDetectors {
  const emitter = new EventEmitter();

  const spikeDetector = new SpikeDetector({
    onSpike: (event: SpikeEvent) => {
      emitter.emit('SPIKE_DETECTED', event);
    },
  });

  const credentialStuffingDetector = new CredentialStuffingDetector({
    onSuspected: (event: CredentialStuffingEvent) => {
      emitter.emit('CREDENTIAL_STUFFING_SUSPECTED', event);
    },
  });

  return {
    detectors: [spikeDetector, credentialStuffingDetector],
    emitter,
  };
}
