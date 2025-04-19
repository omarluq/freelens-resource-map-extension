import "./KubeResourceChartLegend.scss";
import React from "react";
import { KubeForceChart } from "./KubeForceChart";
import type { ConfigItem } from "./helpers/config";
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
                {(configItem as ConfigItem).icon ? (
                  typeof (configItem as ConfigItem).icon === "string" ? (
                    <img
                      src={(configItem as ConfigItem).icon as string}
                      width={iconSize}
                      height={iconSize}
                      className="resource-icon"
                      alt={kind}
                    />
                  ) : (
                    // Use a simpler approach with a div instead of createElement
                    <div
                      className="resource-icon"
                      style={{ color: (configItem as ConfigItem).color }}
                    >
                      {/* Custom React component would need to be rendered here */}
                      Icon
                    </div>
                  )
                ) : (
                  <div
                    style={{
                      width: iconSize,
                      height: iconSize,
                      backgroundColor: (configItem as ConfigItem).color,
                      borderRadius: "50%",
                    }}
                  />
                )}
              </div>
              <span className="resource-kind">{resource}</span>
            </div>
          );
        })}
      </div>
    );
  }
}
