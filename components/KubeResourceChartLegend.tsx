import "./KubeResourceChartLegend.scss"
import React from "react";
import { KubeForceChart } from "./KubeForceChart"
import { ConfigItem } from "./helpers/config";
import { observer } from "mobx-react";

interface Props {
  iconSize?: number;
}

export class KubeResourceChartLegend extends React.Component<Props> {
  static defaultProps: Props = {
    iconSize: 32,
  };

  render() {
    const { iconSize } = this.props;
    return (
      <div className="KubeResourceChartLegend flex column">
        <p className="title">Legend:</p>
        {Object.entries(KubeForceChart.config).map(([kind, configItem]) => {
          const resource = kind;
          const style = { "--color": configItem.color } as React.CSSProperties;
          return (
            <div key={kind} className="resource flex gaps align-center" style={style}>
              <div className="resource-icon">
                {(configItem as ConfigItem).icon ? 
                  React.createElement((configItem as ConfigItem).icon as any, {
                    width: iconSize,
                    height: iconSize,
                    fill: (configItem as ConfigItem).color,
                    className: "resource-icon"
                  }) : 
                  <div 
                    style={{
                      width: iconSize, 
                      height: iconSize, 
                      backgroundColor: (configItem as ConfigItem).color,
                      borderRadius: "50%"
                    }} 
                  />
                }
              </div>
              <span className="resource-kind">{resource}</span>
            </div>
          )
        })}
      </div>
    );
  }
}
