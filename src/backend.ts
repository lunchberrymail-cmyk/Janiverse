import { registerUuidHost } from './uuid-host';
import { registerLibraryHost } from './library-host';

declare const spindle: import('lumiverse-spindle-types').SpindleAPI;
registerUuidHost(spindle);
registerLibraryHost(spindle);
