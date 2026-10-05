import { Camera, FolderOpen, Radar } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Capture, CaseRecord, Detection } from '../../../../shared/contracts/api';
import { ErrorNote, Loading, Row } from '../components/ui';
import { ago, category, dateTime, errorText, ruleTitle } from '../lib/format';
import { hasString, t } from '../lib/i18n';
import type { Nav } from '../lib/nav';
import { rpc } from '../lib/rpc';

/** The word shown for a detection's review state. */
export const detectionStatus = (status: string): string =>
  hasString(`records.status_${status}`) ? t(`records.status_${status}`) : status;

export const caseStatus = (status: string): string =>
  hasString(`records.case_${status}`) ? t(`records.case_${status}`) : status;

/** What triggered a capture, in words. */
export const trigger = (value: string): string =>
  hasString(`triggers.${value}`) ? t(`triggers.${value}`) : value;

/** Where a capture stands: stored, or why it is gone. */
export function captureState(capture: Capture): string {
  if (capture.status === 'uploaded') return t('records.capture_stored');
  if (capture.status === 'expired') {
    if (capture.error === 'sweep_clean') return t('records.capture_clean');
    if (capture.error === 'deleted_by_staff') return t('records.capture_deleted');
    return t('records.capture_expired');
  }
  return hasString(`records.capture_${capture.status}`)
    ? t(`records.capture_${capture.status}`)
    : capture.status;
}

export function DetectionRow({ detection, nav }: { detection: Detection; nav: Nav }) {
  return (
    <Row
      icon={<Radar size={18} />}
      title={ruleTitle(detection.ruleKey)}
      detail={t(
        'records.detection_line',
        category(detection.ruleKey),
        detection.score.toFixed(0),
        detection.outcome,
        ago(detection.occurredAt),
      )}
      id={detection.id}
      status={detectionStatus(detection.status)}
      tone={
        detection.status === 'confirmed'
          ? 'danger'
          : detection.status === 'dismissed'
            ? 'muted'
            : 'accent'
      }
      onClick={() => nav.open('detection', detection.id)}
    />
  );
}

export function CaseRow({ record, nav }: { record: CaseRecord; nav: Nav }) {
  return (
    <Row
      icon={<FolderOpen size={18} />}
      title={record.title}
      detail={`${t('records.case_line', record.detectionCount, record.priority)}${record.assignedTo ? ` · ${record.assignedTo}` : ''} · ${ago(record.updatedAt)}`}
      id={record.id}
      status={caseStatus(record.status)}
      tone={record.status === 'closed' ? 'muted' : 'info'}
      onClick={() => nav.open('case', record.id)}
    />
  );
}

export function CaptureRow({ capture, nav }: { capture: Capture; nav: Nav }) {
  const state = captureState(capture);
  return (
    <Row
      icon={<Camera size={18} />}
      title={t('records.capture_title', trigger(capture.trigger))}
      detail={`${capture.width && capture.height ? `${String(capture.width)}×${String(capture.height)} · ` : ''}${dateTime(capture.createdAt)}`}
      id={capture.id}
      status={state}
      tone={capture.status === 'uploaded' ? 'success' : 'muted'}
      onClick={() => nav.open('capture', capture.id)}
    />
  );
}

/** Loads a stored screenshot over the panel connection and shows it; click to see it at full size. */
export function ImageViewer({ id }: { id: string }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [large, setLarge] = useState(false);

  useEffect(() => {
    let current = true;
    setSource(null);
    setError(null);
    rpc('evidence.image', { id: id as never })
      .then((image) => {
        if (!current) return;
        setSource(image.url ?? `data:${image.mediaType};base64,${image.base64 ?? ''}`);
      })
      .catch((failure: unknown) => {
        if (current) setError(errorText(failure));
      });
    return () => {
      current = false;
    };
  }, [id]);

  if (error) return <ErrorNote message={error} />;
  if (!source) return <Loading label={t('records.loading_image')} />;
  return (
    <button
      type="button"
      className={`evidence-image ${large ? 'large' : ''}`}
      aria-label={large ? 'Shrink screenshot' : 'Enlarge screenshot'}
      onClick={() => setLarge(!large)}
    >
      <img src={source} alt="Captured game screen" />
    </button>
  );
}
