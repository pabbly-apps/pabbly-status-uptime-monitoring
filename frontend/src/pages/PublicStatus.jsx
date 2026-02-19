import { useState, useEffect, useMemo, useCallback } from 'react';
import { getOverallStatus, getUptimeStats, getRecentIncidents, getPrivateIncidents, getTimeline, getAllServicesForAdmin } from '../services/publicService';
import StatusHeader from '../components/public/StatusHeader';
import ServiceCard from '../components/public/ServiceCard';
import StatusTimeline from '../components/public/StatusTimeline';
import IncidentList from '../components/public/IncidentList';
import ServiceDetailsModal from '../components/public/ServiceDetailsModal';
import Loading from '../components/shared/Loading';
import Timestamp from '../components/shared/Timestamp';
import TimezoneToggle from '../components/shared/TimezoneToggle';
import { TimezoneProvider } from '../contexts/TimezoneContext';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

function PublicStatusContent() {
  const { isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [statusData, setStatusData] = useState(null);
  const [uptimeStats, setUptimeStats] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [privateIncidents, setPrivateIncidents] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [selectedService, setSelectedService] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [privateServices, setPrivateServices] = useState([]);
  const [viewMode, setViewMode] = useState('public'); // 'public' or 'private'
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [activeTooltip, setActiveTooltip] = useState(null); // For mobile tooltip on tap

  // Fetch all data
  const fetchData = useCallback(async () => {
    try {
      const [statusRes, uptimeRes, incidentsRes, timelineRes] = await Promise.all([
        getOverallStatus(),
        getUptimeStats(),
        getRecentIncidents(5),
        getTimeline(),
      ]);

      setStatusData(statusRes);
      setUptimeStats(uptimeRes.uptime_stats || []);
      setIncidents(incidentsRes.incidents || []);
      setTimeline(timelineRes.timeline || []);
      setLastUpdated(new Date());

      // If user is authenticated, fetch private services and private incidents
      if (isAuthenticated) {
        try {
          const [allServicesRes, privateIncidentsRes] = await Promise.all([
            getAllServicesForAdmin(),
            getPrivateIncidents(5),
          ]);
          setPrivateServices(allServicesRes.privateServices || []);
          setPrivateIncidents(privateIncidentsRes.incidents || []);
        } catch (error) {
          console.error('Error fetching private data:', error);
          // Don't show error to user, just don't show private data
        }
      } else {
        setPrivateServices([]);
        setPrivateIncidents([]);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load status data');
      setLoading(false);
    }
  }, [isAuthenticated]);

  // Initial load and re-fetch when authentication changes
  useEffect(() => {
    fetchData();

    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      fetchData();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchData]);

  // Merge uptime stats with services - must be called before early returns
  const servicesWithUptime = useMemo(() => {
    if (!statusData?.services) return [];
    return statusData.services.map((service) => {
      const stats = uptimeStats.find((s) => s.id === service.id) || {};
      return {
        ...service,
        uptime_24h: stats.uptime_24h,
        uptime_7d: stats.uptime_7d,
        uptime_30d: stats.uptime_30d,
      };
    });
  }, [statusData, uptimeStats]);

  // Merge uptime stats with private services
  const privateServicesWithUptime = useMemo(() => {
    return privateServices.map((service) => {
      const stats = uptimeStats.find((s) => s.id === service.id) || {};
      return {
        ...service,
        uptime_24h: stats.uptime_24h,
        uptime_7d: stats.uptime_7d,
        uptime_30d: stats.uptime_30d,
      };
    });
  }, [privateServices, uptimeStats]);

  // Calculate status for current view mode
  const currentServices = viewMode === 'public' ? servicesWithUptime : privateServicesWithUptime;
  const servicesDown = currentServices.filter(
    (service) => service.current_status === 'failure' || service.current_status === 'timeout' || service.last_status === 'failure' || service.last_status === 'timeout'
  ).length;
  const totalServices = currentServices.length;

  // Get incidents for current view mode
  const currentIncidents = viewMode === 'public' ? incidents : privateIncidents;

  // Group services by group_id
  const groupedServices = useMemo(() => {
    const grouped = {};
    currentServices.forEach(service => {
      const groupKey = service.group_id || 'ungrouped';
      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          id: service.group_id,
          name: service.group_name || 'Services',
          group_order: service.group_order !== undefined ? service.group_order : 999,
          services: []
        };
      }
      grouped[groupKey].services.push(service);
    });

    // Filter out empty groups and sort by group_order
    const nonEmptyGroups = Object.values(grouped).filter(g => g.services.length > 0);
    return nonEmptyGroups.sort((a, b) => a.group_order - b.group_order);
  }, [currentServices]);

  const handleViewDetails = (service) => {
    setSelectedService(service);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedService(null);
  };

  if (loading) {
    return <Loading message="Loading status..." />;
  }

  if (!statusData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-gray-600">Unable to load status data</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Calculate group status based on visible services
  const getGroupStatus = (services) => {
    const downCount = services.filter(s =>
      s.current_status === 'failure' ||
      s.current_status === 'timeout' ||
      s.last_status === 'failure' ||
      s.last_status === 'timeout'
    ).length;

    if (downCount === 0) return 'operational';
    if (downCount === services.length) return 'major_outage';
    return 'partial_outage';
  };

  // Get status badge for groups
  const getGroupStatusBadge = (status, groupId) => {
    const tooltipId = `group-${groupId}`;
    const isTooltipVisible = activeTooltip === tooltipId;

    const handleTooltipClick = (e) => {
      e.stopPropagation(); // Prevent group collapse toggle
      setActiveTooltip(isTooltipVisible ? null : tooltipId);
      // Auto-hide after 2 seconds
      if (!isTooltipVisible) {
        setTimeout(() => setActiveTooltip(null), 2000);
      }
    };

    if (status === 'operational') {
      return (
        <>
          {/* Mobile: Just the dot with tooltip */}
          <span className="sm:hidden relative" onClick={handleTooltipClick}>
            <span className="h-3 w-3 rounded-full bg-green-500 block cursor-pointer"></span>
            <span className={`absolute bottom-full right-0 mb-2 px-2 py-1 text-xs font-medium text-white bg-gray-800 rounded shadow-lg whitespace-nowrap transition-opacity z-50 ${isTooltipVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              All Operational
            </span>
          </span>
          {/* Desktop: Full badge */}
          <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            <span className="h-2 w-2 rounded-full bg-green-500 mr-1.5"></span>
            All Operational
          </span>
        </>
      );
    }
    if (status === 'major_outage') {
      return (
        <>
          {/* Mobile: Just the dot with tooltip */}
          <span className="sm:hidden relative" onClick={handleTooltipClick}>
            <span className="h-3 w-3 rounded-full bg-red-500 block cursor-pointer"></span>
            <span className={`absolute bottom-full right-0 mb-2 px-2 py-1 text-xs font-medium text-white bg-gray-800 rounded shadow-lg whitespace-nowrap transition-opacity z-50 ${isTooltipVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
              Major Outage
            </span>
          </span>
          {/* Desktop: Full badge */}
          <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
            <span className="h-2 w-2 rounded-full bg-red-500 mr-1.5"></span>
            Major Outage
          </span>
        </>
      );
    }
    return (
      <>
        {/* Mobile: Just the dot with tooltip */}
        <span className="sm:hidden relative" onClick={handleTooltipClick}>
          <span className="h-3 w-3 rounded-full bg-yellow-500 block cursor-pointer"></span>
          <span className={`absolute bottom-full right-0 mb-2 px-2 py-1 text-xs font-medium text-white bg-gray-800 rounded shadow-lg whitespace-nowrap transition-opacity z-50 ${isTooltipVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            Partial Outage
          </span>
        </span>
        {/* Desktop: Full badge */}
        <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          <span className="h-2 w-2 rounded-full bg-yellow-500 mr-1.5"></span>
          Partial Outage
        </span>
      </>
    );
  };

  // Toggle group collapse
  const toggleGroup = (groupId) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Admin View Toggle - At the very top */}
      {isAuthenticated && privateServicesWithUptime.length > 0 && (
        <div className="bg-gray-800 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
            <div className="flex items-center justify-center">
              <div className="inline-flex rounded-md bg-gray-700 p-0.5">
                <button
                  onClick={() => setViewMode('public')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                    viewMode === 'public'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Public Services
                </button>
                <button
                  onClick={() => setViewMode('private')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                    viewMode === 'private'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Private Services
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0">
            <div className="flex flex-col items-center sm:items-start">
              {/* Logo and Title */}
              {statusData.settings.logo_url && (
                <a href="/" className="inline-block">
                  <img
                    src={`${import.meta.env.VITE_API_URL.replace('/api', '')}${statusData.settings.logo_url}`}
                    alt="Logo"
                    className="h-8 sm:h-10 w-auto object-contain mb-2 cursor-pointer hover:opacity-80 transition-opacity"
                  />
                </a>
              )}
              <h1 className="text-lg sm:text-xl font-bold text-gray-900 text-center sm:text-left">
                {statusData.settings.page_title || 'System Status'}
              </h1>
            </div>

            {/* Right Side: Admin Link (if logged in), Timestamp and Timezone */}
            <div className="flex flex-col items-center sm:items-end gap-2 text-xs sm:text-sm text-gray-600">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="flex items-center gap-1">
                  <span className="text-gray-500 hidden sm:inline">Last updated:</span>
                  <span className="text-gray-500 sm:hidden">Updated:</span>
                  <Timestamp timestamp={lastUpdated} format="full" />
                </div>
                {isAuthenticated && (
                  <a
                    href="/admin/dashboard"
                    className="inline-flex items-center px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                  >
                    <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="hidden sm:inline">Admin</span>
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="text-gray-500 hidden sm:inline">Times in:</span>
                <TimezoneToggle />
              </div>
            </div>
          </div>

        </div>
      </header>

      {/* Status Banner */}
      <StatusHeader
        overallStatus={statusData.overall_status}
        totalServices={totalServices}
        servicesDown={servicesDown}
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Services Grid */}
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-2xl font-semibold text-gray-900">
              {viewMode === 'public' ? 'Public Services' : 'Private Services'}
            </h2>
            {viewMode === 'private' && (
              <span className="px-3 py-1 text-xs font-medium bg-amber-100 text-amber-800 rounded-full">
                Admin Only
              </span>
            )}
          </div>

          {currentServices.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg shadow">
              <p className="text-gray-500">
                {viewMode === 'public'
                  ? 'No public services being monitored yet.'
                  : 'No private services being monitored yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4 sm:space-y-8">
              {groupedServices.map(group => {
                const groupStatus = getGroupStatus(group.services);
                const isCollapsed = collapsedGroups[group.id];

                return (
                  <div key={group.id || 'ungrouped'} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-visible">
                    {/* Group Header */}
                    <div
                      className="flex items-center justify-between p-3 sm:p-4 bg-gray-50 sm:bg-white border-b border-gray-200 cursor-pointer hover:bg-gray-100 sm:hover:bg-gray-50 transition-colors rounded-t-lg"
                      onClick={() => toggleGroup(group.id)}
                    >
                      <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                        <svg
                          className={`h-4 w-4 sm:h-5 sm:w-5 text-gray-600 transition-transform flex-shrink-0 ${isCollapsed ? '' : 'rotate-180'}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        <svg className="h-4 w-4 sm:h-5 sm:w-5 text-gray-500 flex-shrink-0 hidden sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        <h3 className="text-base sm:text-lg font-bold text-gray-900 truncate">{group.name}</h3>
                        <span className="text-xs sm:text-sm text-gray-500 flex-shrink-0">
                          ({group.services.length})
                        </span>
                      </div>
                      <div className="flex items-center flex-shrink-0 ml-2">
                        {getGroupStatusBadge(groupStatus, group.id)}
                      </div>
                    </div>

                    {/* Group Services */}
                    {!isCollapsed && (
                      <div className="p-3 sm:p-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
                          {group.services.map((service) => (
                            <ServiceCard
                              key={service.id}
                              service={service}
                              onViewDetails={handleViewDetails}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Separator */}
        {currentIncidents.length > 0 && (
          <div className="mb-12">
            <hr className="border-t border-dotted border-gray-300" />
          </div>
        )}

        {/* Recent Incidents */}
        {currentIncidents.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-6">
              <h2 className="text-2xl font-semibold text-gray-900">
                Recent Incidents
              </h2>
              {viewMode === 'private' && (
                <span className="px-3 py-1 text-xs font-medium bg-amber-100 text-amber-800 rounded-full">
                  Admin Only
                </span>
              )}
            </div>
            <IncidentList incidents={currentIncidents} />
          </section>
        )}

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-gray-200 text-center text-sm text-gray-500">
          {statusData.settings.logo_url && (
            <a href="/" className="inline-block">
              <img
                src={`${import.meta.env.VITE_API_URL.replace('/api', '')}${statusData.settings.logo_url}`}
                alt="Logo"
                className="h-8 w-auto object-contain mx-auto mb-3 cursor-pointer hover:opacity-80 transition-opacity"
              />
            </a>
          )}
          <p>Powered by Pabbly Status Monitor</p>
          <p className="mt-2">
            Auto-refresh enabled (every 30 seconds)
          </p>
        </footer>
      </main>

      {/* Service Details Modal */}
      <ServiceDetailsModal
        service={selectedService}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
      />
    </div>
  );
}

export default function PublicStatus() {
  return (
    <TimezoneProvider>
      <PublicStatusContent />
    </TimezoneProvider>
  );
}
