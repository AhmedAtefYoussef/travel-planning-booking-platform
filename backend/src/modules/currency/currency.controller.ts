import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CurrencyListDto, CurrencyRatesDto } from './dto/currency.dto';
import { CurrencyService } from './currency.service';

@ApiTags('currency')
@Controller('currencies')
export class CurrencyController {
  constructor(private readonly currency: CurrencyService) {}

  @ApiOperation({ summary: '[ITN-18] List supported currencies' })
  @ApiOkResponse({ type: CurrencyListDto })
  @Public()
  @Get()
  async list() {
    return { items: await this.currency.supportedCurrencies() };
  }

  @ApiOperation({ summary: '[ITN-18] Daily cached exchange rates' })
  @ApiOkResponse({ type: CurrencyRatesDto })
  @ApiServiceUnavailableResponse({
    description:
      'No exchange rates have ever been fetched and the FX provider is unreachable',
  })
  @Public()
  @Get('rates')
  rates() {
    return this.currency.getRatesView();
  }
}
