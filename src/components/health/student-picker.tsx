export interface StudentOption {
  id: string;
  name: string;
}

export interface GuardianOption {
  id: string;
  name: string;
  relationship: string;
  primary_contact: boolean;
}
