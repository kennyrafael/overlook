import { Module } from '@nestjs/common';
import { PlansService } from '../plans/plans.service';
import { ClaudeHistoryReader } from './claude-history.reader';
import { DiscoveryService } from './discovery.service';
import { RootScanner } from './root-scanner';

@Module({
  providers: [DiscoveryService, RootScanner, ClaudeHistoryReader, PlansService],
  exports: [DiscoveryService, PlansService],
})
export class DiscoveryModule {}
