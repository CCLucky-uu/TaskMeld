import { useEffect } from "react";
import { ArtifactFiltersBar } from "./ArtifactFiltersBar";
import { ArtifactPreviewPane } from "./ArtifactPreviewPane";
import { ArtifactTreePane } from "./ArtifactTreePane";
import type { ArtifactPipelineOption } from "../model/types";
import { useArtifactBoard } from "../model/useArtifactBoard";

type ArtifactBoardProps = {
  pipelines: ArtifactPipelineOption[];
  onNavigatePipeline: (pipelineId: string) => void;
};

export function ArtifactBoard({ pipelines, onNavigatePipeline }: ArtifactBoardProps) {
  const vm = useArtifactBoard(pipelines);

  useEffect(() => {
    // 首次进入页面默认拉当天数据，避免加载历史全量导致首屏过慢。
    void vm.applyFilters();
    // 这里故意只在首次挂载触发，后续筛选由用户主动操作驱动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section data-center-card className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <div className="p-3">
        <ArtifactFiltersBar
          filters={vm.draftFilters}
          pipelineOptions={vm.mergedPipelineOptions}
          nodeOptions={vm.mergedNodeOptions}
          loading={vm.loading}
          exporting={vm.exporting}
          onChangeFilters={(updater) => {
            vm.setDraftFilters((prev) => updater(prev));
          }}
          onApply={() => {
            void vm.applyFilters();
          }}
          onReset={() => {
            void vm.resetFilters();
          }}
          onRefresh={() => {
            void vm.refresh();
          }}
          onExport={() => {
            void vm.exportFilteredArtifacts();
          }}
        />
      </div>
      {/* 产物页主体吃满剩余高度，仅允许左右面板内部滚动。 */}
      <div className="grid min-h-0 min-w-0 gap-3 overflow-hidden px-3 pb-3 lg:grid-cols-[minmax(340px,42%)_minmax(0,1fr)]">
        <ArtifactTreePane
          groups={vm.groups}
          selectedItemKey={vm.selectedItemKey}
          loading={vm.loading}
          error={vm.error}
          onSelect={(item) => {
            void vm.selectItem(item);
          }}
        />
        <ArtifactPreviewPane
          item={vm.selectedItem}
          content={vm.selectedContent}
          loadingKey={vm.contentLoadingKey}
          contentError={vm.contentError}
        />
      </div>
    </section>
  );
}
