import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface EnrollmentSummary {
  total: number;
  active: number;
  applied: number;
  approved: number;
  enrolled: number;
}

export interface AttendanceSummary {
  scope: "own_class" | "school_wide" | "none";
  marked: number;
  roster: number;
}

export interface AcademicsSummary {
  yearName: string | null;
  termName: string | null;
  classCount: number;
  streamCount: number;
  subjectCount: number;
}

export function EnrollmentWidget({ data }: { data: EnrollmentSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Students</CardTitle>
        <CardDescription>{data.active} active of {data.total} total</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Applied</div>
          <div className="text-lg font-semibold tabular-nums">{data.applied}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Approved</div>
          <div className="text-lg font-semibold tabular-nums">{data.approved}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Enrolled</div>
          <div className="text-lg font-semibold tabular-nums">{data.enrolled}</div>
        </div>
      </CardContent>
      <CardFooter>
        <Button asChild size="sm" variant="outline">
          <Link href="/students">View students</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

export function AdmissionsWidget({ data }: { data: EnrollmentSummary }) {
  const pending = data.applied + data.approved + data.enrolled;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Admissions pipeline</CardTitle>
        <CardDescription>{pending} awaiting the next step</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Awaiting review</div>
          <div className="text-lg font-semibold tabular-nums">{data.applied}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Awaiting class</div>
          <div className="text-lg font-semibold tabular-nums">{data.approved}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Awaiting activation</div>
          <div className="text-lg font-semibold tabular-nums">{data.enrolled}</div>
        </div>
      </CardContent>
      <CardFooter>
        <Button asChild size="sm" variant="outline">
          <Link href="/admissions">Review pipeline</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

export function AttendanceWidget({ data }: { data: AttendanceSummary }) {
  const rate = data.roster > 0 ? Math.round((data.marked / data.roster) * 100) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance today</CardTitle>
        <CardDescription>
          {data.scope === "none"
            ? "No class assigned to you"
            : data.scope === "own_class"
              ? "Your class"
              : "School-wide"}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {data.scope === "none" ? (
          <p className="text-muted-foreground">Nothing to mark.</p>
        ) : (
          <div>
            <span className="text-lg font-semibold tabular-nums">{data.marked}</span>
            <span className="text-muted-foreground"> / {data.roster} marked</span>
            {rate !== null && <span className="ml-2 text-muted-foreground">({rate}%)</span>}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button asChild size="sm" variant="outline">
          <Link href="/attendance">
            {data.marked < data.roster ? "Mark attendance" : "View attendance"}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

export function AcademicsWidget({ data }: { data: AcademicsSummary }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Academics</CardTitle>
        <CardDescription>
          {data.yearName ? `${data.yearName}${data.termName ? ` — ${data.termName}` : ""}` : "No active year set"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Classes</div>
          <div className="text-lg font-semibold tabular-nums">{data.classCount}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Streams</div>
          <div className="text-lg font-semibold tabular-nums">{data.streamCount}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Subjects</div>
          <div className="text-lg font-semibold tabular-nums">{data.subjectCount}</div>
        </div>
      </CardContent>
      <CardFooter>
        <Button asChild size="sm" variant="outline">
          <Link href="/academics">Manage academics</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
