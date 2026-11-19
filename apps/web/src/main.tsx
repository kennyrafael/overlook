// Entry point. Kept tiny so the boot loader paints and the theme stylesheet starts downloading right
// away; the app (React, PrimeReact and their CSS) loads after it, without blocking the first paint.
import './boot/loader';

void import('./bootstrap');
