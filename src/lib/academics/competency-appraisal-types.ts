export interface StreamOption {
  id: string;
  label: string;
}

export interface TermOption {
  id: string;
  label: string;
  status: "upcoming" | "active" | "closed";
}

export interface IndicatorOption {
  id: string;
  type: "core_competency" | "value" | "pci" | "school_authored";
  name: string;
}

export interface BandOption {
  id: string;
  label: string;
}

export interface RosterRatingRow {
  student_id: string;
  admission_number: string | null;
  full_name: string;
  existing: { rating_id: string; band_id: string; observation: string | null } | null;
}

export const TYPE_LABEL: Record<IndicatorOption["type"], string> = {
  core_competency: "Core Competency",
  value: "Value",
  pci: "PCI Area",
  school_authored: "School Indicator",
};
