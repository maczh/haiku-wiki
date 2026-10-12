import { f as flowDb, p as parser$1 } from './flowDb-185abca5-BWy-p6PO.js';
import { f as flowStyles, g as flowRendererV2 } from './styles-f932cba9-CMa_K8Va.js';
import { P as setConfig } from './mermaid.core-DJLwYMBC.js';
import './graph-BSN_XU3L.js';
import './layout-DCSTsSKP.js';
import './index-D3bZfheK.js';

const diagram = {
  parser: parser$1,
  db: flowDb,
  renderer: flowRendererV2,
  styles: flowStyles,
  init: (cnf) => {
    if (!cnf.flowchart) {
      cnf.flowchart = {};
    }
    cnf.flowchart.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
    setConfig({ flowchart: { arrowMarkerAbsolute: cnf.arrowMarkerAbsolute } });
    flowRendererV2.setConf(cnf.flowchart);
    flowDb.clear();
    flowDb.setGen("gen-2");
  }
};

export { diagram };
