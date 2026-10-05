import type { Screen } from './lib/nav';

/** `title` and `description` are locale keys, so the tour is translated with everything else. */
export interface TourStep {
  target: string;
  title: string;
  description: string;
  screen: Screen;
}

export const tourSteps: TourStep[] = [
  {
    screen: 'Overview',
    target: '.brand',
    title: 'tour.welcome.title',
    description: 'tour.welcome.text',
  },
  {
    screen: 'Overview',
    target: '.overview-metrics',
    title: 'tour.glance.title',
    description: 'tour.glance.text',
  },
  {
    screen: 'Overview',
    target: '.workspace-toolbar',
    title: 'tour.attention.title',
    description: 'tour.attention.text',
  },
  {
    screen: 'Players',
    target: '.record-list',
    title: 'tour.players.title',
    description: 'tour.players.text',
  },
  {
    screen: 'Detections',
    target: '.workspace-toolbar',
    title: 'tour.detections.title',
    description: 'tour.detections.text',
  },
  {
    screen: 'Cases',
    target: '.workspace-toolbar',
    title: 'tour.cases.title',
    description: 'tour.cases.text',
  },
  {
    screen: 'Evidence',
    target: '.workspace-toolbar',
    title: 'tour.evidence.title',
    description: 'tour.evidence.text',
  },
  {
    screen: 'Actions',
    target: '.workspace-toolbar',
    title: 'tour.actions.title',
    description: 'tour.actions.text',
  },
  {
    screen: 'Exceptions',
    target: '.workspace-toolbar',
    title: 'tour.exceptions.title',
    description: 'tour.exceptions.text',
  },
  {
    screen: 'Profiles',
    target: '.workspace-toolbar',
    title: 'tour.profiles.title',
    description: 'tour.profiles.text',
  },
  {
    screen: 'Panel access',
    target: '.access-layout',
    title: 'tour.access.title',
    description: 'tour.access.text',
  },
  {
    screen: 'Configuration',
    target: '.color-grid',
    title: 'tour.colors.title',
    description: 'tour.colors.text',
  },
  {
    screen: 'Overview',
    target: '.bypass-control',
    title: 'tour.bypass.title',
    description: 'tour.bypass.text',
  },
  {
    screen: 'Audit',
    target: '.workspace-toolbar',
    title: 'tour.audit.title',
    description: 'tour.audit.text',
  },
];
