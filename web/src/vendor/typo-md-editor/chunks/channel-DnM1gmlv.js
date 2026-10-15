import { U as Utils, K as Color } from './mermaid.core-BzNjkjBi.js';

/* IMPORT */
/* MAIN */
const channel = (color, channel) => {
    return Utils.lang.round(Color.parse(color)[channel]);
};

export { channel as c };
