import { Renderer } from "@freelensapp/extensions";
import React from 'react';

export type NodeObject = object & {
  id?: string;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
};

export type LinkObject = object & {
  source?: string|NodeObject;
  target?: string|NodeObject;
};

export interface ChartDataSeries extends NodeObject {
  id: string;
  object: Renderer.K8sApi.KubeObject;
  kind: string;
  name: string;
  namespace?: string;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  value?: number;
  collapsed?: boolean;
  disabled?: boolean;
  color?: string;
  tooltipHTML?: string;
  links?: LinkObject[];
  visible?: boolean;
}
