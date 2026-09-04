"use client";

import * as React from "react";
import {
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchPlaceholder?: string;
  /** Column id to run the search box against. Defaults to a global filter
   *  across all columns when omitted. */
  searchColumnId?: string;
  enableRowSelection?: boolean;
  /** Rendered above the table, to the right of the search box, when one
   *  or more rows are selected — e.g. "Deactivate (3)" / "Export (3)". */
  renderBulkActions?: (selectedRows: TData[]) => React.ReactNode;
  pageSize?: number;
  /**
   * Server-driven pagination. When set, `data` is expected to be just the
   * current page's rows (not the full dataset) — the caller already ran a
   * `.range()` query. Pass a `manual` object instead of relying on
   * client-side pageSize/getPaginationRowModel, which needs every row in
   * memory to work at all and is what silently turns "list a school's
   * students" into "fetch every student in the school" as data grows.
   * Search/filtering must also become server-side alongside this (see
   * `manual.search`) — a client-side global filter can otherwise only ever
   * search within whatever page happens to already be loaded.
   */
  manual?: {
    pageIndex: number; // 0-based, matching TanStack's convention
    pageCount: number;
    onPageChange: (pageIndex: number) => void;
    totalCount: number;
    search: string;
    onSearchChange: (value: string) => void;
  };
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder = "Search…",
  searchColumnId,
  enableRowSelection = false,
  renderBulkActions,
  pageSize = 20,
  manual,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [clientGlobalFilter, setClientGlobalFilter] = React.useState("");
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter: manual ? manual.search : clientGlobalFilter,
      rowSelection,
      ...(manual ? { pagination: { pageIndex: manual.pageIndex, pageSize: data.length || pageSize } } : {}),
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: manual ? undefined : setClientGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: manual
      ? (updater) => {
          const next = typeof updater === "function" ? updater({ pageIndex: manual.pageIndex, pageSize }) : updater;
          manual.onPageChange(next.pageIndex);
        }
      : undefined,
    enableRowSelection,
    manualPagination: !!manual,
    manualFiltering: !!manual,
    pageCount: manual?.pageCount,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: manual ? undefined : getFilteredRowModel(),
    getPaginationRowModel: manual ? undefined : getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    globalFilterFn: manual
      ? undefined
      : (row, columnId, value) => {
          if (searchColumnId) {
            return String(row.getValue(searchColumnId) ?? "")
              .toLowerCase()
              .includes(String(value).toLowerCase());
          }
          return String(row.getValue(columnId) ?? "")
            .toLowerCase()
            .includes(String(value).toLowerCase());
        },
  });

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const resultCount = manual ? manual.totalCount : table.getFilteredRowModel().rows.length;

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Input
          value={manual ? manual.search : clientGlobalFilter}
          onChange={(e) => (manual ? manual.onSearchChange(e.target.value) : setClientGlobalFilter(e.target.value))}
          placeholder={searchPlaceholder}
          className="h-8 max-w-xs bg-background text-[0.8125rem]"
        />
        {selectedRows.length > 0 && renderBulkActions && (
          <div className="flex items-center gap-2 border-l border-border pl-2">
            {renderBulkActions(selectedRows)}
          </div>
        )}
        <span className="ml-auto text-[0.75rem] text-muted-foreground">
          {resultCount} result
          {resultCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="max-h-[28rem] overflow-auto">
        <Table className="table-dense">
          <TableHeader className="sticky top-0 z-10 bg-muted/70">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(sortable && "cursor-pointer select-none")}
                      onClick={sortable ? header.column.getToggleSortingHandler() : undefined}
                    >
                      {header.isPlaceholder ? null : (
                        <span className="inline-flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sortable &&
                            (sortDir === "asc" ? (
                              <ArrowUp className="size-3" />
                            ) : sortDir === "desc" ? (
                              <ArrowDown className="size-3" />
                            ) : (
                              <ArrowUpDown className="size-3 opacity-40" />
                            ))}
                        </span>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[0.75rem] text-muted-foreground">
        <span>
          Page {(manual ? manual.pageIndex : table.getState().pagination.pageIndex) + 1} of{" "}
          {Math.max(manual ? manual.pageCount : table.getPageCount(), 1)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => (manual ? manual.onPageChange(manual.pageIndex - 1) : table.previousPage())}
            disabled={manual ? manual.pageIndex <= 0 : !table.getCanPreviousPage()}
          >
            <ChevronLeft className="size-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => (manual ? manual.onPageChange(manual.pageIndex + 1) : table.nextPage())}
            disabled={manual ? manual.pageIndex >= manual.pageCount - 1 : !table.getCanNextPage()}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

