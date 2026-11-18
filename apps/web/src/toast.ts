import { createRef } from 'react';
import type { Toast } from 'primereact/toast';

/** App-wide toast, rendered once in the layout. */
export const appToast = createRef<Toast>();
