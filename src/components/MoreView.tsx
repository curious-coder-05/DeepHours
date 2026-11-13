import React from 'react';
import { SettingsView, type SettingsViewProps } from './SettingsView';

export type MoreViewProps = SettingsViewProps;

export const MoreView: React.FC<MoreViewProps> = (props) => (
  <SettingsView {...props} />
);
