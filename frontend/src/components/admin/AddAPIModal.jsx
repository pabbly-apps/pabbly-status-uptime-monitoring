import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { createAPI, updateAPI, getAPIGroups } from '../../services/adminService';

export default function AddAPIModal({ isOpen, onClose, onSuccess, editingAPI }) {
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    monitoring_interval: 60,
    expected_status_code: 200,
    timeout_duration: 30000,
    is_active: true,
    is_public: true,
    group_id: '',
  });
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    if (isOpen) {
      fetchGroups();
    }
  }, [isOpen]);

  const fetchGroups = async () => {
    try {
      const response = await getAPIGroups();
      setGroups(response.groups || []);
    } catch (error) {
      console.error('Error fetching groups:', error);
    }
  };

  useEffect(() => {
    if (editingAPI) {
      setFormData({
        name: editingAPI.name,
        url: editingAPI.url,
        monitoring_interval: editingAPI.monitoring_interval,
        expected_status_code: editingAPI.expected_status_code,
        timeout_duration: editingAPI.timeout_duration,
        is_active: editingAPI.is_active,
        is_public: editingAPI.is_public ?? true,
        group_id: editingAPI.group_id || '',
      });
    } else {
      setFormData({
        name: '',
        url: '',
        monitoring_interval: 60,
        expected_status_code: 200,
        timeout_duration: 30000,
        is_active: true,
        is_public: true,
        group_id: '',
      });
    }
  }, [editingAPI, isOpen]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : type === 'number' ? Number(value) : value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (editingAPI) {
        await updateAPI(editingAPI.id, formData);
        toast.success('API updated successfully');
      } else {
        await createAPI(formData);
        toast.success('API added successfully');
      }
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Save error:', error);
      toast.error(error.response?.data?.message || 'Failed to save API');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        ></div>

        {/* Modal */}
        <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold text-gray-900">
              {editingAPI ? 'Edit API' : 'Add New API'}
            </h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                API Name *
              </label>
              <input
                type="text"
                id="name"
                name="name"
                required
                value={formData.name}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., GitHub API"
              />
            </div>

            {/* URL */}
            <div>
              <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
                API URL *
              </label>
              <input
                type="url"
                id="url"
                name="url"
                required
                value={formData.url}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://api.example.com/health"
              />
            </div>

            {/* Group */}
            <div>
              <label htmlFor="group_id" className="block text-sm font-medium text-gray-700 mb-1">
                Group
              </label>
              <select
                id="group_id"
                name="group_id"
                value={formData.group_id}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select a group (optional)</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">Organize APIs into groups for better management</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Monitoring Interval */}
              <div>
                <label htmlFor="monitoring_interval" className="block text-sm font-medium text-gray-700 mb-1">
                  Interval (seconds)
                </label>
                <input
                  type="number"
                  id="monitoring_interval"
                  name="monitoring_interval"
                  min="60"
                  value={formData.monitoring_interval}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Minimum: 60 seconds (1 minute)</p>
              </div>

              {/* Expected Status Code */}
              <div>
                <label htmlFor="expected_status_code" className="block text-sm font-medium text-gray-700 mb-1">
                  Expected Status Code
                </label>
                <input
                  type="number"
                  id="expected_status_code"
                  name="expected_status_code"
                  min="100"
                  max="599"
                  value={formData.expected_status_code}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="mt-1 text-xs text-gray-500">Default: 200</p>
              </div>
            </div>

            {/* Timeout */}
            <div>
              <label htmlFor="timeout_duration" className="block text-sm font-medium text-gray-700 mb-1">
                Timeout (milliseconds)
              </label>
              <input
                type="number"
                id="timeout_duration"
                name="timeout_duration"
                min="1000"
                value={formData.timeout_duration}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">Default: 30000ms (30 seconds)</p>
            </div>

            {/* Active Toggle */}
            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_active"
                name="is_active"
                checked={formData.is_active}
                onChange={handleChange}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
                Active (enable monitoring)
              </label>
            </div>

            {/* Public Toggle */}
            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_public"
                name="is_public"
                checked={formData.is_public}
                onChange={handleChange}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="is_public" className="ml-2 block text-sm text-gray-900">
                Public (visible on status page to everyone)
              </label>
            </div>
            <p className="text-xs text-gray-500 -mt-2 ml-6">
              If unchecked, this API will only be visible to logged-in admins
            </p>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Saving...' : editingAPI ? 'Update API' : 'Add API'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
