import {AcronisAdapter} from './acronis.mjs';
import {HaloAdapter} from './halopsa.mjs';
import {ConnectWiseAdapter} from './connectwise.mjs';
import {insist} from '../errors.mjs';

export function adapterFor(config, options = {}) {
  const types = {acronis: AcronisAdapter, halopsa: HaloAdapter, connectwise: ConnectWiseAdapter};
  insist(Object.hasOwn(types, config.provider), 'configuration', 'Unsupported MSP adapter.');
  return new types[config.provider](config, options);
}
