import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ViewEntity } from './view.entity';
import { ViewsController } from './views.controller';
import { ViewsService } from './views.service';

@Module({
  imports: [TypeOrmModule.forFeature([ViewEntity])],
  controllers: [ViewsController],
  providers: [ViewsService],
})
export class ViewsModule {}
