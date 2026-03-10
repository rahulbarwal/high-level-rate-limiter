export { SpikeDetector } from './spikeDetector';
export type { SpikeEvent, SpikeDetectorOptions } from './spikeDetector';

export { CredentialStuffingDetector } from './credentialStuffingDetector';
export type {
  CredentialStuffingEvent,
  CredentialStuffingDetectorOptions,
} from './credentialStuffingDetector';

import { SpikeDetector } from './spikeDetector';
import { CredentialStuffingDetector } from './credentialStuffingDetector';

export interface AbuseDetectors {
  spikeDetector: SpikeDetector;
  credentialStuffingDetector: CredentialStuffingDetector;
}

export function createAbuseDetectors(): AbuseDetectors {
  throw new Error('not implemented');
}
