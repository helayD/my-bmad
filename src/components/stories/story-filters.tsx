"use client";

import { Search } from "lucide-react";
import {
  Filters,
  createFilter,
  type Filter,
  type FilterFieldConfig,
} from "@/components/reui/filters";
import { Input } from "@/components/ui/input";
import type { Epic } from "@/lib/bmad/types";

const STATUS_OPTIONS = [
  { value: "done", label: "已完成" },
  { value: "in-progress", label: "进行中" },
  { value: "review", label: "待评审" },
  { value: "blocked", label: "已阻塞" },
  { value: "planned", label: "已规划" },
  { value: "ready-for-dev", label: "可开发" },
  { value: "backlog", label: "待处理" },
];

interface StoryFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  filters: Filter<string>[];
  onFiltersChange: (filters: Filter<string>[]) => void;
  epics: Epic[];
}

export function StoryFilters({
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  epics,
}: StoryFiltersProps) {
  const fields: FilterFieldConfig<string>[] = [
    {
      key: "status",
      label: "状态",
      type: "multiselect",
      options: STATUS_OPTIONS,
    },
    {
      key: "epicId",
      label: "Epic",
      type: "select",
      options: epics.map((e) => ({
        value: e.id,
        label: `Epic ${e.id}: ${e.title}`,
      })),
    },
  ];

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="搜索 Story 标题或编号..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>
      <Filters
        filters={filters}
        fields={fields}
        onChange={onFiltersChange}
        size="sm"
      />
    </div>
  );
}

export { createFilter, type Filter };
