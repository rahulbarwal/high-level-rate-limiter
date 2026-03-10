// Wire-up guide for auth middleware:
// Call credentialStuffingDetector.record(tenantId, res.statusCode) in auth middleware
// after the response status is determined.

import { EventEmitter } from 'events';

export { SpikeDetector } from './spikeDetector';
export type { SpikeEvent, SpikeDetectorOptions } from './spikeDetector';

export { CredentialStuffingDetector } from './credentialStuffingDetector';
export type {
  CredentialStuffingEvent,
  CredentialStuffingDetectorOptions,
} from './credentialStuffingDetector';

import { SpikeDetector } from './spikeDetector';
import type { SpikeEvent } from './spikeDetector';
import { CredentialStuffingDetector } from './credentialStuffingDetector';
import type { CredentialStuffingEvent } from './credentialStuffingDetector';

export interface AbuseDetectors {
  spikeDetector: SpikeDetector;
  credentialStuffingDetector: CredentialStuffingDetector;
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

  return { spikeDetector, credentialStuffingDetector, emitter };
}
