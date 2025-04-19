import type { Renderer } from "@freelensapp/extensions";
import { observer } from "mobx-react";
import { ChartDataSeries } from "./helpers/types";
import { KubeResourceChart } from "./KubeResourceChart";

@observer
export class KubeIngressChart extends KubeResourceChart {
  registerStores() {
    this.kubeObjectStores = [
      this.podsStore,
      this.serviceStore,
      this.ingressStore,
      this.pvcStore,
      this.configMapStore,
      this.secretStore,
      this.deploymentStore,
      this.daemonsetStore,
      this.statefulsetStore,
    ];
  }

  generateChartDataSeries = () => {
    const nodes = [...this.nodes];
    const links = [...this.links];

    //this.generateControllerNode();
    const { object: ingress } = this.props;
    this.generateIngress(ingress as Renderer.K8sApi.Ingress);

    if (nodes.length !== this.nodes.length || links.length !== this.links.length) {
      // TODO: Improve the logic
      this.updateState(this.nodes, this.links);
    }
  };

  protected generateIngress(ingress: Renderer.K8sApi.Ingress) {
    const ingressNode = this.getIngressNode(ingress);

    for (const rule of ingress.spec.rules) {
      for (const path of rule.http.paths) {
        const serviceName =
          (path.backend as { serviceName?: string; service?: { name: string } }).serviceName ||
          (path.backend as { serviceName?: string; service?: { name: string } }).service?.name;

        const service = this.serviceStore.getByName(serviceName, ingress.getNs());
        if (service) {
          const selector = service.spec.selector;
          const serviceNode = this.generateNode(service);
          this.addLink({ source: ingressNode.id, target: serviceNode.id });

          if (selector) {
            const pods = this.podsStore
              .getAllByNs(ingress.getNs())
              .filter((item: Renderer.K8sApi.Pod) => {
                const itemLabels = item.metadata.labels || {};
                return Object.entries(selector).every(([key, value]) => {
                  return itemLabels[key] === value;
                });
              });

            for (const pod of pods) {
              this.generatePodNode(pod);
            }
          }
        }
      }
    }
  }

  protected generatePodNode(pod: Renderer.K8sApi.Pod) {
    this.getPodNode(pod, false);
    this.generateServices([pod]);

    const controller = this.getControllerObject(pod);

    if (controller) {
      this.getControllerChartNode(controller, [pod], false);
    }
  }

  getControllerObject(pod: Renderer.K8sApi.Pod) {
    if (pod.getOwnerRefs()[0]?.kind === "StatefulSet") {
      return this.statefulsetStore.getByName(pod.getOwnerRefs()[0].name, pod.getNs());
    }

    if (pod.getOwnerRefs()[0]?.kind === "DaemonSet") {
      return this.daemonsetStore.getByName(pod.getOwnerRefs()[0].name, pod.getNs());
    }
    return this.deploymentStore.items.find((deployment) =>
      deployment.getSelectors().every((label) => pod.getLabels().includes(label)),
    );
  }
}
