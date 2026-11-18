import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ViewsService } from './views.service';

@Controller('views')
export class ViewsController {
  constructor(private views: ViewsService) {}

  @Get() list() { return this.views.list(); }
  @Post() create(@Body() body: { name?: unknown; filters?: unknown }) { return this.views.create(body); }
  @Put(':id') update(@Param('id') id: string, @Body() body: { name?: unknown; filters?: unknown }) { return this.views.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.views.remove(id); }
}
