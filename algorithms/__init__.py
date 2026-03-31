"""
algorithms — UEI edge and cloud algorithm modules

  cac     Context-Aware Adaptive Control     edge / real-time  (Pi)
  rda     Risk-Indexed Derating Algorithm    edge / real-time  (Pi)
  rhf     Rolling Health Forecast            cloud / scheduled (API server)
  carbon  Carbon Emissions Calculator        edge / real-time  (Pi)
"""
from .cac    import ContextAwareAdaptiveControl
from .rda    import RiskIndexedDeratingAlgorithm
from .rhf    import RollingHealthForecast
from .carbon import CarbonCalculator

__all__ = [
    "ContextAwareAdaptiveControl",
    "RiskIndexedDeratingAlgorithm",
    "RollingHealthForecast",
    "CarbonCalculator",
]
